import { describe, it, expect, vi, beforeEach } from "vitest";

import { triggerProcessing, type ProcessingSettings } from "../process.js";
import { requestContext } from "../../auth/context.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("triggerProcessing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends temp_file_ids and settings to /auto", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        jobs: [{ id: "job-1", temp_file_id: "temp-1", status: "queued" }],
        credits_used: 4,
        credits_remaining: 16,
      }),
    });

    const settings: ProcessingSettings = {
      output_format: "webp",
      output_seo_tag_gen: true,
    };

    const result = await triggerProcessing({
      baseUrl: "https://api.glassypic.com",
      tempFileIds: ["temp-1"],
      settings,
      authHeaders: { "X-Session-Token": "token-123" },
    });

    expect(result.jobs[0].id).toBe("job-1");
    expect(result.credits_used).toBe(4);

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.glassypic.com/auto");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body);
    expect(body.temp_file_ids).toEqual(["temp-1"]);
    expect(body.settings.output_format).toBe("webp");
    expect(body.settings.output_seo_tag_gen).toBe(true);
  });

  it("includes X-Session-Token header when session token is provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        jobs: [{ id: "job-1", temp_file_id: "temp-1", status: "queued" }],
        credits_used: 4,
        credits_remaining: 16,
      }),
    });

    await triggerProcessing({
      baseUrl: "https://api.glassypic.com",
      tempFileIds: ["temp-1"],
      settings: {},
      authHeaders: { "X-Session-Token": "my-session-token" },
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Session-Token"]).toBe("my-session-token");
  });

  it("omits X-Slack-Idempotency-Key when no idempotency key is provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        jobs: [{ id: "job-1", temp_file_id: "temp-1", status: "queued" }],
        credits_used: 4,
        credits_remaining: 16,
      }),
    });

    await triggerProcessing({
      baseUrl: "https://api.glassypic.com",
      tempFileIds: ["temp-1"],
      settings: {},
      authHeaders: { "X-Session-Token": "my-session-token" },
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Slack-Idempotency-Key"]).toBeUndefined();
  });

  it("does not include X-Session-Token header when sessionToken is null", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        jobs: [{ id: "job-1", temp_file_id: "temp-1", status: "queued" }],
        credits_used: 4,
        credits_remaining: 16,
      }),
    });

    await triggerProcessing({
      baseUrl: "https://api.glassypic.com",
      tempFileIds: ["temp-1"],
      settings: {},
      authHeaders: {},
    });

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers["X-Session-Token"]).toBeUndefined();
  });

  it("sends all temp_file_ids in the request body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        jobs: [
          { id: "job-1", temp_file_id: "temp-1", status: "queued" },
          { id: "job-2", temp_file_id: "temp-2", status: "queued" },
        ],
        credits_used: 8,
        credits_remaining: 12,
      }),
    });

    const result = await triggerProcessing({
      baseUrl: "https://api.glassypic.com",
      tempFileIds: ["temp-1", "temp-2"],
      settings: { output_format: "webp" },
      authHeaders: {},
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.temp_file_ids).toEqual(["temp-1", "temp-2"]);
    expect(result.jobs).toHaveLength(2);
  });

  it("throws generic error on 500 with server detail", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers(),
      json: async () => ({ detail: "Internal processing error" }),
    });

    await expect(
      triggerProcessing({
        baseUrl: "https://api.glassypic.com",
        tempFileIds: ["temp-1"],
        settings: {},
        authHeaders: {},
      })
    ).rejects.toThrow("Internal processing error");
  });

  it("throws a credits-only message on 402", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ detail: "Payment required" }),
    });

    await expect(
      triggerProcessing({
        baseUrl: "https://api.glassypic.com",
        tempFileIds: ["t1"],
        settings: {},
        authHeaders: {},
      }),
    ).rejects.toThrow(/insufficient credits/i);
  });

  it("402 message names no wallet, key, or cryptocurrency", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ detail: "Payment required" }),
    });

    const error = await triggerProcessing({
      baseUrl: "https://api.glassypic.com",
      tempFileIds: ["t1"],
      settings: {},
      authHeaders: {},
    }).catch((e) => e as Error);

    expect(error.message).not.toMatch(/wallet|private key|base network|crypto/i);
    expect(error.message).toMatch(/login|upgrade/i);
  });

  it("throws on insufficient credits (429) with parsed details", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: new Headers({
        "X-RateLimit-Remaining": "2",
        "Retry-After": "86400",
      }),
      json: async () => ({
        detail: "Insufficient credits. Need 4, have 2.",
      }),
    });

    await expect(
      triggerProcessing({
        baseUrl: "https://api.glassypic.com",
        tempFileIds: ["temp-1"],
        settings: { output_seo_tag_gen: true },
        authHeaders: { "X-Session-Token": "token" },
      })
    ).rejects.toThrow(/Insufficient credits/);
  });

  describe("exhausted guest credits", () => {
    const guestExhausted = () =>
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        json: async () => ({ is_guest: true, credits_limit: 20, detail: "Insufficient credits." }),
      });
    const run = () =>
      triggerProcessing({
        baseUrl: "https://api.glassypic.com",
        tempFileIds: ["temp-1"],
        settings: { output_seo_tag_gen: true },
        authHeaders: {},
      });

    it("points local (stdio) guests to the login tool and states no allowance figures", async () => {
      guestExhausted();
      const error = await run().catch((e) => e);
      expect(error.message).toMatch(/`login` tool/);
      expect(error.message).not.toMatch(/\/day|\/month/);
    });

    it("points remote (HTTP) guests to the connector sign-in, not a login tool that does not exist", async () => {
      guestExhausted();
      const error = await requestContext
        .run({ authHeaders: {}, sessionId: "mcp-session-1" }, run)
        .catch((e) => e);
      expect(error.message).toMatch(/connector/);
      expect(error.message).not.toMatch(/`login` tool/);
    });
  });
});
