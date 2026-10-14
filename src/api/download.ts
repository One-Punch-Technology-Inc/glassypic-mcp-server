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

interface SignedUrlResult {
  /** Direct download link. Works with no credentials, until it expires. */
  url: string;
  filename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  expiresInSeconds: number;
}

/**
 * Asks the API for a pre-signed download link for a finished job.
 *
 * `GET /download/{job}` is owner-gated, so a link to it cannot be opened by the person who
 * ran the job (a browser sends no X-Session-Token). This call is made WITH the owner's
 * credentials and returns a time-limited link that needs none.
 */
export async function getSignedDownloadUrl(params: DownloadParams): Promise<SignedUrlResult> {
  const { baseUrl, jobId, authHeaders = {} } = params;

  const response = await fetch(`${baseUrl}/download/${encodeURIComponent(jobId)}/url`, {
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
    throw new ApiError(body.detail || "Could not create a download link", response.status);
  }

  const data = (await response.json()) as {
    url?: unknown;
    filename?: unknown;
    content_type?: unknown;
    size?: unknown;
    expires_in?: unknown;
  };
  // The link is handed to a person or an agent to open, so refuse anything that is not https.
  if (typeof data.url !== "string" || !data.url.startsWith("https://")) {
    throw new ApiError("The server did not return a usable download link.", 502);
  }

  return {
    url: data.url,
    filename: typeof data.filename === "string" ? data.filename : null,
    contentType: typeof data.content_type === "string" ? data.content_type : null,
    sizeBytes: typeof data.size === "number" ? data.size : null,
    expiresInSeconds: typeof data.expires_in === "number" ? data.expires_in : 900,
  };
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
