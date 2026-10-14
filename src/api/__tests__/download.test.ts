import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadFile } from "../download.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("downloadFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads file and returns buffer with filename", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({
        "Content-Disposition": 'attachment; filename="hero.polished.webp"',
      }),
      arrayBuffer: async () => new ArrayBuffer(100),
    });

    const result = await downloadFile({
      baseUrl: "https://api.glassypic.com",
      jobId: "job-1",
    });

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.length).toBe(100);
    expect(result.filename).toBe("hero.polished.webp");
  });

  it("sends auth headers when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(1),
    });

    await downloadFile({
      baseUrl: "https://api.glassypic.com",
      jobId: "job-1",
      authHeaders: { "X-Session-Token": "guest-token" },
    });

    expect(mockFetch).toHaveBeenCalledWith("https://api.glassypic.com/download/job-1", {
      headers: { "X-Session-Token": "guest-token" },
    });
  });

  it("throws on expired job (410)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ detail: "Job expired" }),
    });

    await expect(
      downloadFile({ baseUrl: "https://api.glassypic.com", jobId: "job-1" })
    ).rejects.toThrow("Job has expired");
  });

  it("throws on job not completed (400)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ detail: "Job not completed" }),
    });

    await expect(
      downloadFile({ baseUrl: "https://api.glassypic.com", jobId: "job-1" })
    ).rejects.toThrow("Job not completed");
  });

  it("throws on job not found (404)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Job not found" }),
    });

    await expect(
      downloadFile({ baseUrl: "https://api.glassypic.com", jobId: "job-1" })
    ).rejects.toThrow("Job not found");
  });

  it("throws generic error on 500", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: "Server error" }),
    });

    await expect(
      downloadFile({ baseUrl: "https://api.glassypic.com", jobId: "job-1" })
    ).rejects.toThrow("Server error");
  });

  it("uses fallback filename 'output' when Content-Disposition header is absent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(50),
    });

    const result = await downloadFile({
      baseUrl: "https://api.glassypic.com",
      jobId: "job-1",
    });

    expect(result.filename).toBe("output");
    expect(result.buffer.length).toBe(50);
  });
});

describe("getSignedDownloadUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const signedBody = {
    url: "https://storage.googleapis.com/bucket/job-1?X-Goog-Signature=abc",
    filename: "hero.polished.webp",
    content_type: "image/webp",
    size: 4096,
    expires_in: 900,
  };

  it("asks /download/{job}/url with the owner's credentials and returns the signed link", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => signedBody });

    const { getSignedDownloadUrl } = await import("../download.js");
    const result = await getSignedDownloadUrl({
      baseUrl: "https://api.glassypic.com",
      jobId: "job-1",
      authHeaders: { "X-Session-Token": "guest-token" },
    });

    expect(mockFetch).toHaveBeenCalledWith("https://api.glassypic.com/download/job-1/url", {
      headers: { "X-Session-Token": "guest-token" },
    });
    expect(result).toEqual({
      url: signedBody.url,
      filename: "hero.polished.webp",
      contentType: "image/webp",
      sizeBytes: 4096,
      expiresInSeconds: 900,
    });
  });

  it("refuses a link that is not https", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...signedBody, url: "http://evil.example/x" }) });
    const { getSignedDownloadUrl } = await import("../download.js");
    await expect(
      getSignedDownloadUrl({ baseUrl: "https://api.glassypic.com", jobId: "job-1" }),
    ).rejects.toThrow(/usable download link/i);
  });

  it("refuses a response with no link", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ filename: "x" }) });
    const { getSignedDownloadUrl } = await import("../download.js");
    await expect(
      getSignedDownloadUrl({ baseUrl: "https://api.glassypic.com", jobId: "job-1" }),
    ).rejects.toThrow(/usable download link/i);
  });

  it("falls back to 15 minutes when the API omits the expiry", async () => {
    const { expires_in: _omit, ...withoutExpiry } = signedBody;
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => withoutExpiry });
    const { getSignedDownloadUrl } = await import("../download.js");
    const result = await getSignedDownloadUrl({ baseUrl: "https://api.glassypic.com", jobId: "job-1" });
    expect(result.expiresInSeconds).toBe(900);
  });

  it.each([
    [410, /expired/i],
    [400, /not completed/i],
    [404, /not found/i],
  ])("maps HTTP %i to a clear error", async (status, message) => {
    mockFetch.mockResolvedValueOnce({ ok: false, status, json: async () => ({}) });
    const { getSignedDownloadUrl } = await import("../download.js");
    await expect(
      getSignedDownloadUrl({ baseUrl: "https://api.glassypic.com", jobId: "job-1" }),
    ).rejects.toThrow(message);
  });

  it("surfaces the API's detail on other failures", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ detail: "Not your job" }) });
    const { getSignedDownloadUrl } = await import("../download.js");
    await expect(
      getSignedDownloadUrl({ baseUrl: "https://api.glassypic.com", jobId: "job-1" }),
    ).rejects.toThrow("Not your job");
  });

  it("URL-encodes the job id", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => signedBody });
    const { getSignedDownloadUrl } = await import("../download.js");
    await getSignedDownloadUrl({ baseUrl: "https://api.glassypic.com", jobId: "a/b" });
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.glassypic.com/download/a%2Fb/url");
  });
});
