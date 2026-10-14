import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../api/upload.js", () => ({ uploadFile: vi.fn(), uploadUrl: vi.fn() }));
vi.mock("../../api/process.js", () => ({ triggerProcessing: vi.fn() }));
vi.mock("../../api/status.js", () => ({
  waitForCompletion: vi.fn(),
  STANDARD_TIMEOUT_MS: 60000,
  UPSCALE_TIMEOUT_MS: 120000,
}));
vi.mock("../../api/download.js", () => ({ downloadFile: vi.fn(), getSignedDownloadUrl: vi.fn() }));

import { getSignedDownloadUrl } from "../../api/download.js";
import { uploadUrl } from "../../api/upload.js";
import { triggerProcessing } from "../../api/process.js";
import { waitForCompletion } from "../../api/status.js";
import { optimizeImage } from "../optimize.js";
import { requestContext } from "../../auth/context.js";
import { guestSessions } from "../../auth/guest.js";

const BASE_URL = "https://api.glassypic.com";
const IMAGE = "https://example.com/photo.jpg";
const sessions: string[] = [];

/** A fresh, open MCP session (the transport calls begin() when a session starts). */
function newSessionId(): string {
  const id = `guest-test-${Math.random().toString(36).slice(2)}`;
  sessions.push(id);
  guestSessions.begin(id);
  return id;
}

/** Runs optimizeImage the way the HTTP transport does for one tools/call. */
function callAsRemote(sessionId: string, authHeaders: Record<string, string> = {}) {
  return requestContext.run({ authHeaders, sessionId }, () =>
    optimizeImage({ input: IMAGE, baseUrl: BASE_URL }),
  );
}

const uploaded = (token: string | null) => ({
  temp_file_id: "temp-1",
  original_filename: "photo.jpg",
  file_size: 1000,
  mime_type: "image/jpeg",
  session_token: token,
});

beforeEach(() => {
  process.env.MCP_TRANSPORT = "http";
  vi.mocked(triggerProcessing).mockResolvedValue({
    success: true,
    jobs: [{ id: "job-1", temp_file_id: "temp-1", status: "queued" }],
    credits_used: 3,
    credits_remaining: 17,
  } as any);
  vi.mocked(waitForCompletion).mockResolvedValue({ job_id: "job-1", status: "completed" } as any);
  vi.mocked(getSignedDownloadUrl).mockResolvedValue({
    url: "https://storage.googleapis.com/bucket/job-1?sig=abc",
    filename: "photo.polished.jpg",
    contentType: "image/jpeg",
    sizeBytes: 1000,
    expiresInSeconds: 900,
  });
});

afterEach(() => {
  delete process.env.MCP_TRANSPORT;
  for (const id of sessions.splice(0)) guestSessions.delete(id);
  vi.clearAllMocks();
});

describe("optimize_image as a remote guest", () => {
  it("keeps the guest session the first upload creates and uses it for every later call", async () => {
    const sessionId = newSessionId();
    vi.mocked(uploadUrl).mockResolvedValueOnce(uploaded("guest-token-1"));

    await callAsRemote(sessionId);

    // The upload itself had no credentials (a first-run guest has none yet)...
    expect(vi.mocked(uploadUrl).mock.calls[0][0].authHeaders).toEqual({});
    // ...but processing and the status stream are actor-scoped, so they must carry the token.
    expect(vi.mocked(triggerProcessing).mock.calls[0][0].authHeaders).toEqual({
      "X-Session-Token": "guest-token-1",
    });
    expect(vi.mocked(waitForCompletion).mock.calls[0][0].headers).toEqual({
      "X-Session-Token": "guest-token-1",
    });
    expect(guestSessions.get(sessionId)).toBe("guest-token-1");
  });

  it("returns a pre-signed link requested under the guest's own token, so the guest can open it", async () => {
    const sessionId = newSessionId();
    vi.mocked(uploadUrl).mockResolvedValueOnce(uploaded("guest-token-1"));

    const result = await callAsRemote(sessionId);

    // The link is requested WITH the guest's identity (the owner-gated route needs it)...
    expect(vi.mocked(getSignedDownloadUrl).mock.calls[0][0].authHeaders).toEqual({
      "X-Session-Token": "guest-token-1",
    });
    // ...and what the guest gets back needs no credentials at all.
    expect(result.output_path).toBe("https://storage.googleapis.com/bucket/job-1?sig=abc");
    expect(result.output_path).not.toContain("/download/");
    expect(result.download_expires_in_seconds).toBe(900);
  });

  it("reuses that guest on the next call in the same session instead of creating another", async () => {
    const sessionId = newSessionId();
    vi.mocked(uploadUrl)
      .mockResolvedValueOnce(uploaded("guest-token-1"))
      .mockResolvedValueOnce(uploaded(null));

    await callAsRemote(sessionId);
    await callAsRemote(sessionId);

    expect(vi.mocked(uploadUrl).mock.calls[1][0].authHeaders).toEqual({
      "X-Session-Token": "guest-token-1",
    });
  });

  it("concurrent first calls share ONE guest session", async () => {
    const sessionId = newSessionId();
    let minted = 0;
    vi.mocked(uploadUrl).mockImplementation(async ({ authHeaders }) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      // Like the API: no token -> create a guest session; token -> reuse it.
      return uploaded(authHeaders["X-Session-Token"] ? null : `guest-token-${++minted}`);
    });

    await Promise.all([callAsRemote(sessionId), callAsRemote(sessionId), callAsRemote(sessionId)]);

    expect(minted).toBe(1);
    const uploadHeaders = vi.mocked(uploadUrl).mock.calls.map(([arg]) => arg.authHeaders);
    expect(uploadHeaders.filter((h) => !h["X-Session-Token"])).toHaveLength(1);
    const processHeaders = vi.mocked(triggerProcessing).mock.calls.map(([arg]) => arg.authHeaders);
    expect(new Set(processHeaders.map((h) => h["X-Session-Token"]))).toEqual(
      new Set(["guest-token-1"]),
    );
  });

  it("different MCP sessions get different guests", async () => {
    const a = newSessionId();
    const b = newSessionId();
    vi.mocked(uploadUrl)
      .mockResolvedValueOnce(uploaded("guest-a"))
      .mockResolvedValueOnce(uploaded("guest-b"));

    await callAsRemote(a);
    await callAsRemote(b);

    expect(guestSessions.get(a)).toBe("guest-a");
    expect(guestSessions.get(b)).toBe("guest-b");
  });

  it("a logged-in caller keeps its own identity and never gets a guest token stored", async () => {
    const sessionId = newSessionId();
    vi.mocked(uploadUrl).mockResolvedValueOnce(uploaded("unexpected-guest-token"));

    await callAsRemote(sessionId, { Authorization: "Bearer mcp_user" });

    expect(vi.mocked(uploadUrl).mock.calls[0][0].authHeaders).toEqual({ Authorization: "Bearer mcp_user" });
    expect(vi.mocked(triggerProcessing).mock.calls[0][0].authHeaders).toEqual({
      Authorization: "Bearer mcp_user",
    });
    expect(guestSessions.get(sessionId)).toBeNull();
  });

  it("replaces an expired cached token with the one the upload returns", async () => {
    const sessionId = newSessionId();
    guestSessions.set(sessionId, "expired-token");
    // The API rejects the stale token, creates a new guest session and returns its token.
    vi.mocked(uploadUrl).mockResolvedValueOnce(uploaded("fresh-token"));

    await callAsRemote(sessionId);

    expect(vi.mocked(uploadUrl).mock.calls[0][0].authHeaders).toEqual({
      "X-Session-Token": "expired-token",
    });
    // Everything after the upload must use the replacement, or the status stream 403s.
    expect(vi.mocked(triggerProcessing).mock.calls[0][0].authHeaders).toEqual({
      "X-Session-Token": "fresh-token",
    });
    expect(vi.mocked(waitForCompletion).mock.calls[0][0].headers).toEqual({
      "X-Session-Token": "fresh-token",
    });
    expect(guestSessions.get(sessionId)).toBe("fresh-token");
  });

  it("keeps a still-valid cached token when the upload echoes it back", async () => {
    const sessionId = newSessionId();
    guestSessions.set(sessionId, "good-token");
    vi.mocked(uploadUrl).mockResolvedValueOnce(uploaded("good-token"));

    await callAsRemote(sessionId);

    expect(guestSessions.get(sessionId)).toBe("good-token");
    expect(vi.mocked(triggerProcessing).mock.calls[0][0].authHeaders).toEqual({
      "X-Session-Token": "good-token",
    });
  });

  it("concurrent calls that both hit an expired token: each job keeps its own session, the store keeps the first replacement", async () => {
    const sessionId = newSessionId();
    guestSessions.set(sessionId, "expired-token");
    let issued = 0;
    vi.mocked(uploadUrl).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return uploaded(`replacement-${++issued}`);
    });

    await Promise.all([callAsRemote(sessionId), callAsRemote(sessionId)]);

    // Each job is processed under the guest session its own upload created...
    const processTokens = vi
      .mocked(triggerProcessing)
      .mock.calls.map(([arg]) => arg.authHeaders["X-Session-Token"])
      .sort();
    expect(processTokens).toEqual(["replacement-1", "replacement-2"]);
    // ...and the second one did not clobber the first for later calls.
    expect(guestSessions.get(sessionId)).toBe("replacement-1");
  });

  it("an explicit authToken is never written into the session's guest store", async () => {
    const sessionId = newSessionId();
    vi.mocked(uploadUrl).mockResolvedValueOnce(uploaded("api-issued-token"));

    await requestContext.run({ authHeaders: {}, sessionId }, () =>
      optimizeImage({ input: IMAGE, baseUrl: BASE_URL, authToken: "explicit-token" }),
    );

    expect(guestSessions.get(sessionId)).toBeNull();
    expect(vi.mocked(triggerProcessing).mock.calls[0][0].authHeaders).toEqual({
      "X-Session-Token": "explicit-token",
    });
  });

  it("an upload that finishes after the session closed does not recreate its token entry", async () => {
    const sessionId = newSessionId();
    let finishUpload!: () => void;
    vi.mocked(uploadUrl).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = () => resolve(uploaded("late-token"));
        }),
    );

    const call = callAsRemote(sessionId);
    await vi.waitFor(() => expect(uploadUrl).toHaveBeenCalled());

    guestSessions.delete(sessionId); // the MCP session closes mid-upload
    finishUpload();
    await call;

    expect(guestSessions.get(sessionId)).toBeNull();
  });

  it("queued first calls do not run after their session closed", async () => {
    const sessionId = newSessionId();
    let finishFirst!: () => void;
    vi.mocked(uploadUrl).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishFirst = () => resolve(uploaded("tok"));
        }),
    );

    const first = callAsRemote(sessionId);
    await vi.waitFor(() => expect(uploadUrl).toHaveBeenCalledTimes(1));
    const queued = callAsRemote(sessionId); // waits behind `first`

    guestSessions.delete(sessionId);
    finishFirst();
    await first;

    await expect(queued).rejects.toThrow(/session closed/i);
    expect(uploadUrl).toHaveBeenCalledTimes(1); // the queued call never uploaded
  });

  it("a failed first upload does not block the session's next call", async () => {
    const sessionId = newSessionId();
    vi.mocked(uploadUrl)
      .mockRejectedValueOnce(new Error("upload failed"))
      .mockResolvedValueOnce(uploaded("guest-token-2"));

    await expect(callAsRemote(sessionId)).rejects.toThrow("upload failed");
    await callAsRemote(sessionId);

    expect(guestSessions.get(sessionId)).toBe("guest-token-2");
  });
});
