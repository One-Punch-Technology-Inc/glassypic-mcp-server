import { buildAuthHeaders, ApiError } from "../api/client.js";
import { uploadBuffer } from "../api/uploadBuffer.js";
import { triggerProcessing } from "../api/process.js";
import { waitForCompletion, STANDARD_TIMEOUT_MS, UPSCALE_TIMEOUT_MS } from "../api/status.js";

export interface OptimizeBufferParams {
  bytes: Buffer;
  filename: string;
  mimetype: string;
  output_width_px?: number;
  output_height_px?: number;
  output_resize_behavior: "pad" | "crop";
  output_seo_tag_gen?: boolean;
  output_format?: "original" | "jpg" | "png" | "webp" | "avif" | "gif" | "svg" | "ico";
  authToken: string;
  idempotencyKey: string;
  baseUrl: string;
  timeoutMs?: number;
}

export interface OptimizeBufferResult {
  bytes: Buffer;
  seo_alt_text: string | null;
  seo_filename: string | null;
  /** False when seo_alt_text/seo_filename are a fallback, not real AI tagging. Defaults to
   * true when the server response omits the field (older API version). */
  executed_tag: boolean;
  processed_format: string | null;
  output_width_px: number | null;
  output_height_px: number | null;
  original_width_px: number | null;
  original_height_px: number | null;
  output_size_bytes: number;
}

export async function optimizeBuffer(params: OptimizeBufferParams): Promise<OptimizeBufferResult> {
  const authHeaders = buildAuthHeaders(params.authToken);
  const uploadResult = await uploadBuffer({
    baseUrl: params.baseUrl,
    bytes: params.bytes,
    filename: params.filename,
    mimetype: params.mimetype,
    authHeaders,
  });

  const processResult = await triggerProcessing({
    baseUrl: params.baseUrl,
    tempFileIds: [uploadResult.temp_file_id],
    authHeaders,
    idempotencyKey: params.idempotencyKey,
    settings: {
      output_width: params.output_width_px,
      output_height: params.output_height_px,
      output_resize_behavior: params.output_resize_behavior,
      output_seo_tag_gen: params.output_seo_tag_gen ?? true,
      output_format: params.output_format ?? "original",
    },
  });

  const job = processResult.jobs[0];
  if (!job?.id) {
    throw new ApiError("No job created by the server.", 500);
  }

  // Pipeline-aware budget: optimizeBuffer never sends an explicit upscale
  // factor, but the server may still auto-trigger upscale (target > source).
  const isUpscaleClass = job.auto_upscale === true;
  const completedJob = await waitForCompletion({
    baseUrl: params.baseUrl,
    jobId: job.id,
    timeoutMs: params.timeoutMs ?? (isUpscaleClass ? UPSCALE_TIMEOUT_MS : STANDARD_TIMEOUT_MS),
    headers: authHeaders,
  });

  const downloadResponse = await fetch(`${params.baseUrl}/download/${encodeURIComponent(job.id)}`, {
    headers: { ...authHeaders },
  });
  if (!downloadResponse.ok) {
    const body = await downloadResponse.json().catch(() => ({}));
    throw new ApiError(
      body.detail || `Download failed: ${downloadResponse.status}`,
      downloadResponse.status,
      body.detail,
      body,
    );
  }

  const executedTag = completedJob.executed_tag ?? true;
  return {
    bytes: Buffer.from(await downloadResponse.arrayBuffer()),
    // Defensive, not just trusting the server: the backend normally nulls these on a tag
    // fallback, but a stale/version-skewed revision could still return the fallback
    // placeholder alongside executed_tag: false. Slack copies seo_alt_text straight into the
    // upload's accessibility alt_text, so a client-side gate here is the last checkpoint
    // before that fallback text would be presented as real AI output.
    seo_alt_text: executedTag ? (completedJob.seo_alt_text ?? null) : null,
    seo_filename: executedTag ? (completedJob.seo_filename ?? null) : null,
    executed_tag: executedTag,
    processed_format: completedJob.processed_format ?? null,
    output_width_px: completedJob.processed_width ?? null,
    output_height_px: completedJob.processed_height ?? null,
    original_width_px: completedJob.original_width ?? null,
    original_height_px: completedJob.original_height ?? null,
    output_size_bytes: completedJob.processed_size ?? 0,
  };
}
