import { ApiError } from "./client.js";
import { EventSource as EventSourcePoly } from "eventsource";

/** Default SSE wait budget for non-upscale jobs. */
export const STANDARD_TIMEOUT_MS = 60_000;
/**
 * Extended SSE wait budget for jobs that may execute upscale. Upscale p95 is
 * measured at 62.2s — the standard 60s budget would time out a still-running
 * job and report it as failed (latency spec Phase 0 instrument prerequisite,
 * mirrors the equivalent web-client fix).
 */
export const UPSCALE_TIMEOUT_MS = 120_000;

export interface CompletedJob {
  job_id: string;
  status: "completed" | "failed" | "expired";
  processed_filename?: string | null;
  processed_size?: number | null;
  processed_format?: string | null;
  processed_width?: number | null;
  processed_height?: number | null;
  processed_compression_ratio?: number | null;
  original_width?: number | null;
  original_height?: number | null;
  seo_alt_text?: string | null;
  seo_filename?: string | null;
  seo_keywords?: string[] | null;
  /** False when the tag step fell back to a filename-derived placeholder (e.g. a Gemini
   * timeout) instead of real AI tagging — the caller wasn't charged for it either. */
  executed_tag?: boolean;
  error?: string | null;
}

interface StatusParams {
  baseUrl: string;
  jobId: string;
  timeoutMs?: number;
  /**
   * Auth headers for the stream. The SSE endpoint is actor-scoped; unlike the
   * browser, the eventsource polyfill can send headers via its `fetch` option,
   * so MCP authenticates with its normal Bearer/session header (no stream token).
   */
  headers?: Record<string, string>;
}

export function waitForCompletion(params: StatusParams): Promise<CompletedJob> {
  const { baseUrl, jobId, timeoutMs = STANDARD_TIMEOUT_MS, headers } = params;

  const timeoutSecs = Math.round(timeoutMs / 1000);

  return new Promise((resolve, reject) => {
    const ESConstructor =
      typeof EventSource !== "undefined" ? EventSource : (EventSourcePoly as any);

    // The eventsource polyfill accepts a `fetch` override that lets us attach
    // auth headers the browser EventSource could never send.
    const esOptions =
      headers && Object.keys(headers).length > 0
        ? {
            fetch: (input: any, init: any) =>
              fetch(input, {
                ...init,
                headers: { ...(init?.headers ?? {}), ...headers },
              }),
          }
        : undefined;

    const es = new ESConstructor(`${baseUrl}/status/${encodeURIComponent(jobId)}/stream`, esOptions);

    const timeout = setTimeout(() => {
      es.close();
      reject(new ApiError(`Processing timed out after ${timeoutSecs} seconds.`, 504));
    }, timeoutMs);

    es.addEventListener("complete", (event: any) => {
      clearTimeout(timeout);
      es.close();

      let data: CompletedJob;
      try {
        data = JSON.parse(event.data);
      } catch {
        reject(new ApiError("Invalid response from server.", 500));
        return;
      }

      if (data.status === "completed") {
        resolve(data);
      } else {
        reject(
          new ApiError(
            `Processing failed: ${data.error ?? "Unknown error"}`,
            500,
            data.error ?? undefined,
          ),
        );
      }
    });

    es.addEventListener("error", (event: any) => {
      clearTimeout(timeout);
      es.close();
      let data: { message?: string } = {};
      try {
        if (event.data) data = JSON.parse(event.data);
      } catch {
        // ignore parse errors, use fallback message
      }
      reject(
        new ApiError(
          `Processing error: ${data.message ?? "Connection lost"}`,
          500,
          data.message,
        ),
      );
    });

    es.addEventListener("timeout", () => {
      clearTimeout(timeout);
      es.close();
      reject(new ApiError(`Processing timed out after ${timeoutSecs} seconds.`, 504));
    });
  });
}
