import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock API modules to avoid real HTTP calls in the download URL test
vi.mock("../../api/upload.js", () => ({ uploadFile: vi.fn(), uploadUrl: vi.fn() }));
vi.mock("../../api/process.js", () => ({ triggerProcessing: vi.fn() }));
vi.mock("../../api/status.js", () => ({
  waitForCompletion: vi.fn(),
  STANDARD_TIMEOUT_MS: 60000,
  UPSCALE_TIMEOUT_MS: 120000,
}));
vi.mock("../../api/download.js", () => ({ downloadFile: vi.fn(), getSignedDownloadUrl: vi.fn() }));
vi.mock("../../session/manager.js", () => ({
  SessionManager: vi.fn(() => ({ getAuthHeaders: vi.fn().mockReturnValue({}), saveToken: vi.fn() })),
}));
vi.mock("../../api/client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../api/client.js")>();
  return { ...original, getAuthHeaders: vi.fn() };
});

describe("optimize_image in remote mode", () => {
  beforeEach(() => {
    process.env.MCP_TRANSPORT = "http";
  });
  afterEach(() => {
    delete process.env.MCP_TRANSPORT;
    vi.clearAllMocks();
  });

  it("rejects local file paths in HTTP mode", async () => {
    const { resolveInput } = await import("../optimize.js");
    expect(() => resolveInput("/Users/test/image.png")).toThrow(
      /local file paths are not supported/i
    );
  });

  it("returns a usable pre-signed download link instead of a local path in HTTP mode", async () => {
    const { getAuthHeaders } = await import("../../api/client.js");
    const { getSignedDownloadUrl } = await import("../../api/download.js");
    vi.mocked(getSignedDownloadUrl).mockResolvedValueOnce({
      url: "https://storage.googleapis.com/bucket/job-abc?X-Goog-Signature=abc",
      filename: "photo.polished.jpg",
      contentType: "image/jpeg",
      sizeBytes: 45000,
      expiresInSeconds: 900,
    });
    const { uploadUrl } = await import("../../api/upload.js");
    const { triggerProcessing } = await import("../../api/process.js");
    const { waitForCompletion } = await import("../../api/status.js");

    vi.mocked(getAuthHeaders).mockReturnValueOnce(undefined as unknown as Record<string, string>);
    vi.mocked(uploadUrl).mockResolvedValueOnce({
      temp_file_id: "temp-1",
      original_filename: "photo.jpg",
      file_size: 100000,
      mime_type: "image/jpeg",
      session_token: null,
    });
    vi.mocked(triggerProcessing).mockResolvedValueOnce({
      success: true,
      jobs: [{ id: "job-abc", temp_file_id: "temp-1", status: "queued" }],
      credits_used: 3,
      credits_remaining: 17,
    });
    vi.mocked(waitForCompletion).mockResolvedValueOnce({
      job_id: "job-abc",
      status: "completed",
      processed_size: 45000,
      processed_format: "jpg",
      processed_width: 1920,
      processed_height: 1080,
      processed_compression_ratio: 0.45,
      seo_alt_text: "A photo",
      seo_keywords: ["photo"],
      seo_filename: "photo",
    });

    const { optimizeImage } = await import("../optimize.js");
    const result = await optimizeImage({
      input: "https://example.com/photo.jpg",
      baseUrl: "https://api.glassypic.com",
    });

    // A pre-signed link (works with no credentials), not the owner-gated /download/<job> URL
    expect(result.output_path).toBe("https://storage.googleapis.com/bucket/job-abc?X-Goog-Signature=abc");
    expect(result.output_path).not.toContain("api.glassypic.com/download/");
    expect(result.download_expires_in_seconds).toBe(900);
    expect(vi.mocked(getSignedDownloadUrl).mock.calls[0][0]).toMatchObject({
      baseUrl: "https://api.glassypic.com",
      jobId: "job-abc",
    });
    expect(result.output_size_bytes).toBe(45000);
    expect(result.output_format).toBe("jpg");
  });
});
