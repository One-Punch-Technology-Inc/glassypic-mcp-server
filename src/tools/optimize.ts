import * as fs from "node:fs";
import * as path from "node:path";
import { uploadFile, uploadUrl } from "../api/upload.js";
import { triggerProcessing, type ProcessingSettings } from "../api/process.js";
import { waitForCompletion, STANDARD_TIMEOUT_MS, UPSCALE_TIMEOUT_MS } from "../api/status.js";
import { downloadFile } from "../api/download.js";
import { resolveInput as resolveInputUtil, isUrl, extractFilenameFromUrl } from "../utils/input.js";

/**
 * Resolves the input path/URL, with a guard for HTTP mode (remote URLs only).
 * Exported for testing.
 */
export function resolveInput(input: string): ReturnType<typeof resolveInputUtil> {
  if (process.env.MCP_TRANSPORT === "http" && !input.startsWith("http://") && !input.startsWith("https://")) {
    throw new Error("Local file paths are not supported in remote mode. Please provide a URL (https://...).");
  }
  return resolveInputUtil(input);
}
import { resolveUniqueOutputPath } from "../utils/output.js";
import { resolveApiBaseUrl, buildAuthHeaders } from "../api/client.js";
import { SessionManager } from "../session/manager.js";

export interface OptimizeImageParams {
  input: string;
  output_path?: string;
  output_format?: "original" | "jpg" | "png" | "webp" | "avif" | "gif" | "svg" | "ico";
  output_width_px?: number;
  output_height_px?: number;
  output_upscale_factor?: 2 | 4;
  output_resize_behavior?: "pad" | "crop";
  output_seo_tag_gen?: boolean;
  output_file_size_limit?: number;
  confirm_gif_cost?: boolean;
  gif_frame_limit?: number;
  _gif_temp_file_id?: string;
  authToken?: string;
  idempotencyKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface OptimizeImageResult {
  [key: string]: unknown;
  output_path: string;
  output_size_bytes: number;
  output_width_px: number | null;
  output_height_px: number | null;
  output_format: string | null;
  compression_ratio: number | null;
  seo_alt_text: string | null;
  seo_keywords: string[] | null;
  seo_filename: string | null;
}

export async function optimizeImage(
  params: OptimizeImageParams,
): Promise<OptimizeImageResult> {
  // Explicit param wins (the Slack app and tests rely on passing it directly).
  // Otherwise fall back to the configured host, not a raw default, so
  // GLASSYPIC_API_URL actually reaches image processing like it does login/status.
  const baseUrl = params.baseUrl ?? resolveApiBaseUrl().baseUrl;

  // 1. Resolve input and upload
  let authHeaders = buildAuthHeaders(params.authToken);
  let uploadResult: Awaited<ReturnType<typeof uploadFile>>;
  let inputFilename: string;
  let inputIsUrl: boolean;

  if (params._gif_temp_file_id && params.confirm_gif_cost) {
    // Reuse the upload from a previous GIF cost warning — no re-upload needed
    inputFilename = isUrl(params.input)
      ? extractFilenameFromUrl(params.input)
      : (await resolveInput(params.input)).filename;
    inputIsUrl = isUrl(params.input);
    uploadResult = {
      temp_file_id: params._gif_temp_file_id,
      original_filename: inputFilename,
      file_size: 0,
      mime_type: "image/gif",
      session_token: null,
    };
  } else if (isUrl(params.input)) {
    // URL input: use server-side fetch (skip client-side download)
    inputFilename = extractFilenameFromUrl(params.input);
    inputIsUrl = true;
    uploadResult = await uploadUrl({
      baseUrl,
      url: params.input,
      filename: inputFilename,
      authHeaders,
    });
  } else {
    // Local file: read bytes and upload
    const input = await resolveInput(params.input);
    inputFilename = input.filename;
    inputIsUrl = input.isUrl;
    uploadResult = await uploadFile({
      baseUrl,
      fileBuffer: input.buffer,
      filename: input.filename,
      authHeaders,
    });
  }

  // If the upload minted a fresh guest session, persist it AND rebuild
  // authHeaders from it before any further call. The pre-upload snapshot
  // above is correct for the upload itself (a first-run guest has no session
  // yet) but is stale for everything after — process/status/download are all
  // actor-scoped, so reusing an empty/old header here 403s a first-run guest
  // out of their own job (regression fixed 2026-07-22).
  if (uploadResult.session_token && process.env.MCP_TRANSPORT !== "http") {
    new SessionManager().saveToken(uploadResult.session_token);
    authHeaders = buildAuthHeaders(params.authToken);
  }

  // Check if animated GIF needs cost confirmation
  const isAnimatedGif = uploadResult.gif_frame_count && uploadResult.gif_frame_count > 1;
  if (isAnimatedGif && !params.confirm_gif_cost) {
    const frameLimit = params.gif_frame_limit ?? 100;
    const framesToProcess = Math.min(uploadResult.gif_frame_count!, frameLimit);
    let perFrameCost = 3; // compress always runs
    if (params.output_width_px || params.output_height_px) perFrameCost += 1;
    if (params.output_upscale_factor) perFrameCost += 2;
    const tagCost = params.output_seo_tag_gen !== false ? 1 : 0;
    const totalCost = framesToProcess * perFrameCost + tagCost;

    const warning = [
      `Animated GIF detected: ${inputFilename}`,
      `  ${uploadResult.gif_frame_count} frames, ${uploadResult.gif_fps ?? "?"} fps`,
      `  ${framesToProcess} frames × ${perFrameCost} credits = ${totalCost} credits`,
      ``,
      `  Animated GIFs are processed frame-by-frame for highest quality.`,
      `  To proceed, call optimize_image again with:`,
      `    confirm_gif_cost: true`,
      `    _gif_temp_file_id: "${uploadResult.temp_file_id}"`,
      `  To reduce cost, set gif_frame_limit (1-100, default 100).`,
    ].join("\n");

    return {
      output_path: "",
      output_size_bytes: 0,
      output_width_px: null,
      output_height_px: null,
      output_format: null,
      compression_ratio: null,
      seo_alt_text: null,
      seo_keywords: null,
      seo_filename: null,
      _gif_warning: warning,
      _gif_temp_file_id: uploadResult.temp_file_id,
    };
  }

  // 3. Build settings (smart defaults: compress always, SEO tags on)
  const settings: ProcessingSettings = {
    output_format: params.output_format ?? "original",
    output_seo_tag_gen: params.output_seo_tag_gen ?? true,
    output_seo_rename: false,
  };
  if (params.output_width_px !== undefined) {
    settings.output_width = params.output_width_px;
  }
  if (params.output_height_px !== undefined) {
    settings.output_height = params.output_height_px;
  }
  if (params.output_upscale_factor !== undefined) {
    settings.output_upscale_factor = params.output_upscale_factor;
  }
  // When dimensions are set, pass resize_behavior (pad default, crop opt-in)
  if (params.output_width_px !== undefined || params.output_height_px !== undefined) {
    settings.output_resize_behavior = params.output_resize_behavior ?? "pad";
  }
  if (params.output_file_size_limit !== undefined) {
    settings.output_file_size_limit = params.output_file_size_limit;
  }
  if (params.gif_frame_limit !== undefined) {
    settings.gif_frame_limit = params.gif_frame_limit;
  }

  // 4. Trigger processing
  const processResult = await triggerProcessing({
    baseUrl,
    tempFileIds: [uploadResult.temp_file_id],
    settings,
    authHeaders,
    idempotencyKey: params.idempotencyKey,
  });

  const job = processResult.jobs[0];
  if (!job?.id) {
    throw new Error("No job created by the server.");
  }

  // 5. Wait for completion via SSE (actor-scoped — send auth headers)
  // Pipeline-aware budget: a job may execute upscale either because the
  // caller explicitly requested it, or because the server auto-triggered it
  // (target > source) — job.auto_upscale reports the latter after the fact.
  const isUpscaleClass = params.output_upscale_factor !== undefined || job.auto_upscale === true;
  const completedJob = await waitForCompletion({
    baseUrl,
    jobId: job.id,
    timeoutMs: params.timeoutMs ?? (isUpscaleClass ? UPSCALE_TIMEOUT_MS : STANDARD_TIMEOUT_MS),
    headers: authHeaders,
  });

  // 6. In HTTP mode: return download URL (no local disk write)
  if (process.env.MCP_TRANSPORT === "http") {
    const downloadUrl = `${baseUrl}/download/${encodeURIComponent(job.id)}`;
    return {
      output_path: downloadUrl,
      output_size_bytes: completedJob.processed_size ?? 0,
      output_width_px: completedJob.processed_width ?? null,
      output_height_px: completedJob.processed_height ?? null,
      output_format: completedJob.processed_format ?? null,
      compression_ratio: completedJob.processed_compression_ratio ?? null,
      seo_alt_text: completedJob.seo_alt_text ?? null,
      seo_keywords: completedJob.seo_keywords ?? null,
      seo_filename: completedJob.seo_filename ?? null,
    };
  }

  // stdio mode: download to local disk (existing code)
  const downloadResult = await downloadFile({ baseUrl, jobId: job.id, authHeaders });

  // 7. Resolve output path and save
  const outputPath = resolveUniqueOutputPath({
    inputPath: params.input,
    isUrl: inputIsUrl,
    filename: inputFilename,
    outputPath: params.output_path,
    outputFormat:
      params.output_format && params.output_format !== "original"
        ? params.output_format
        : completedJob.processed_format ?? undefined,
    seoFilename:
      params.output_seo_tag_gen !== false
        ? (completedJob.seo_filename ?? undefined)
        : undefined,
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, downloadResult.buffer);

  return {
    output_path: outputPath,
    output_size_bytes: completedJob.processed_size ?? downloadResult.buffer.length,
    output_width_px: completedJob.processed_width ?? null,
    output_height_px: completedJob.processed_height ?? null,
    output_format: completedJob.processed_format ?? null,
    compression_ratio: completedJob.processed_compression_ratio ?? null,
    seo_alt_text: completedJob.seo_alt_text ?? null,
    seo_keywords: completedJob.seo_keywords ?? null,
    seo_filename: completedJob.seo_filename ?? null,
  };
}
