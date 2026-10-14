import { ApiError } from "./client.js";

interface DownloadParams {
  baseUrl: string;
  jobId: string;
  authHeaders?: Record<string, string>;
}

interface DownloadResult {
  buffer: Buffer;
  filename: string;
}

export async function downloadFile(params: DownloadParams): Promise<DownloadResult> {
  const { baseUrl, jobId, authHeaders = {} } = params;

  const response = await fetch(`${baseUrl}/download/${encodeURIComponent(jobId)}`, {
    headers: authHeaders,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 410) {
      throw new ApiError("Job has expired. Files are only available for a limited time.", 410);
    }
    if (response.status === 400) {
      throw new ApiError("Job not completed yet.", 400);
    }
    if (response.status === 404) {
      throw new ApiError("Job not found.", 404);
    }
    throw new ApiError(body.detail || "Download failed", response.status);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filenameMatch = disposition.match(/filename="?([^";\s]+)"?/);
  const filename = filenameMatch?.[1] ?? "output";

  return { buffer, filename };
}
