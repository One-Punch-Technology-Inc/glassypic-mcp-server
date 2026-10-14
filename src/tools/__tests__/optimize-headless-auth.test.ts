import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

class FakeEventSource {
  private listeners: Record<string, Array<(event: { data: string }) => void>> = {};

  constructor(_url: string) {}

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
    if (type === "complete") {
      queueMicrotask(() => {
        listener({
          data: JSON.stringify({
            job_id: "j1",
            status: "completed",
            processed_width: 1080,
            processed_height: 1920,
            processed_size: 1000,
            seo_alt_text: "a cat",
          }),
        });
      });
    }
  }

  close() {}
}

describe("optimizeImage headless auth", () => {
  let tmpHome: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalTransport: string | undefined;

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "glassypic-optimize-auth-"));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalTransport = process.env.MCP_TRANSPORT;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    process.env.MCP_TRANSPORT = "http";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalTransport === undefined) delete process.env.MCP_TRANSPORT;
    else process.env.MCP_TRANSPORT = originalTransport;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("sends the injected X-Session-Token on upload and /auto, with idempotency on /auto only", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/upload/url")) {
        return jsonResponse({ temp_file_id: "t1", session_token: null });
      }
      if (url.endsWith("/auto")) {
        return jsonResponse({
          success: true,
          jobs: [{ id: "j1", temp_file_id: "t1", status: "queued" }],
          credits_used: 5,
          credits_remaining: 95,
        });
      }
      if (url.endsWith("/download/j1/url")) {
        return jsonResponse({
          url: "https://storage.googleapis.com/bucket/j1?sig=abc",
          filename: "cat.webp",
          content_type: "image/webp",
          size: 1000,
          expires_in: 900,
        });
      }
      throw new Error(`unexpected url ${url}`);
    });

    const { optimizeImage } = await import("../optimize.js");
    const result = await optimizeImage({
      input: "https://example.com/cat.jpg",
      output_width_px: 1080,
      output_height_px: 1920,
      output_resize_behavior: "crop",
      output_seo_tag_gen: true,
      authToken: "guest_workspace_1",
      idempotencyKey: "slack:T1:1700000000.0001:instagram_story",
      baseUrl: "https://api.test",
    });

    const uploadCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/upload/url"));
    expect(uploadCall).toBeTruthy();
    const uploadHeaders = uploadCall![1].headers as Record<string, string>;
    expect(uploadHeaders["X-Session-Token"]).toBe("guest_workspace_1");
    expect(uploadHeaders["X-Slack-Idempotency-Key"]).toBeUndefined();

    const autoCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/auto"));
    expect(autoCall).toBeTruthy();
    const headers = autoCall![1].headers as Record<string, string>;
    expect(headers["X-Session-Token"]).toBe("guest_workspace_1");
    expect(headers["X-Slack-Idempotency-Key"]).toBe("slack:T1:1700000000.0001:instagram_story");

    // The returned link is a pre-signed one, requested with the same identity as the job.
    const linkCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/download/j1/url"));
    expect(linkCall).toBeTruthy();
    expect((linkCall![1].headers as Record<string, string>)["X-Session-Token"]).toBe("guest_workspace_1");
    expect(result.output_path).toBe("https://storage.googleapis.com/bucket/j1?sig=abc");
    expect(result.download_expires_in_seconds).toBe(900);
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
