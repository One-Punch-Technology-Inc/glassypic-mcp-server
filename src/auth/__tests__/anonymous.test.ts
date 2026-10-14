import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignIn = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { signInAnonymously: mockSignIn },
  })),
}));

describe("AnonymousSessionStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://abc123.supabase.co";
    process.env.SUPABASE_ANON_KEY = "test-anon-key";
  });

  it("returns null when SUPABASE_URL is not configured", async () => {
    delete process.env.SUPABASE_URL;
    const { AnonymousSessionStore } = await import("../anonymous.js");
    const store = new AnonymousSessionStore();
    const result = await store.getOrCreate("session-1");
    expect(result).toBeNull();
  });

  it("creates a new anonymous user and returns JWT for new session", async () => {
    mockSignIn.mockResolvedValueOnce({
      data: { session: { access_token: "eyJanon.jwt.token" } },
      error: null,
    });
    const { AnonymousSessionStore } = await import("../anonymous.js");
    const store = new AnonymousSessionStore();
    const result = await store.getOrCreate("session-abc");
    expect(result).toBe("eyJanon.jwt.token");
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it("reuses cached JWT for the same session ID", async () => {
    mockSignIn.mockResolvedValueOnce({
      data: { session: { access_token: "eyJanon.jwt.token" } },
      error: null,
    });
    const { AnonymousSessionStore } = await import("../anonymous.js");
    const store = new AnonymousSessionStore();
    await store.getOrCreate("session-abc");
    await store.getOrCreate("session-abc");
    expect(mockSignIn).toHaveBeenCalledTimes(1); // not called again
  });

  it("creates separate users for different session IDs", async () => {
    mockSignIn
      .mockResolvedValueOnce({ data: { session: { access_token: "eyJtoken1" } }, error: null })
      .mockResolvedValueOnce({ data: { session: { access_token: "eyJtoken2" } }, error: null });
    const { AnonymousSessionStore } = await import("../anonymous.js");
    const store = new AnonymousSessionStore();
    const t1 = await store.getOrCreate("session-1");
    const t2 = await store.getOrCreate("session-2");
    expect(t1).toBe("eyJtoken1");
    expect(t2).toBe("eyJtoken2");
  });

  it("concurrent first calls for one session share a single sign-in and identity", async () => {
    let release!: (value: unknown) => void;
    mockSignIn.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const { AnonymousSessionStore } = await import("../anonymous.js");
    const store = new AnonymousSessionStore();

    const calls = Array.from({ length: 5 }, () => store.getOrCreate("session-race"));
    release({ data: { session: { access_token: "eyJonly", expires_in: 3600 } }, error: null });
    const tokens = await Promise.all(calls);

    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(new Set(tokens)).toEqual(new Set(["eyJonly"]));
  });

  it("concurrent calls for different sessions still get separate identities", async () => {
    mockSignIn
      .mockResolvedValueOnce({ data: { session: { access_token: "eyJa" } }, error: null })
      .mockResolvedValueOnce({ data: { session: { access_token: "eyJb" } }, error: null });
    const { AnonymousSessionStore } = await import("../anonymous.js");
    const store = new AnonymousSessionStore();
    const [a, b] = await Promise.all([store.getOrCreate("s-a"), store.getOrCreate("s-b")]);
    expect(new Set([a, b])).toEqual(new Set(["eyJa", "eyJb"]));
    expect(mockSignIn).toHaveBeenCalledTimes(2);
  });

  it("a failed shared sign-in is not cached: the next call retries", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSignIn
      .mockResolvedValueOnce({ data: { session: null }, error: { status: 429, message: "limit" } })
      .mockResolvedValueOnce({ data: { session: { access_token: "eyJretry" } }, error: null });
    const { AnonymousSessionStore } = await import("../anonymous.js");
    const store = new AnonymousSessionStore();
    const failed = await Promise.all([store.getOrCreate("s-fail"), store.getOrCreate("s-fail")]);
    expect(failed).toEqual([null, null]);
    expect(mockSignIn).toHaveBeenCalledTimes(1);
    expect(await store.getOrCreate("s-fail")).toBe("eyJretry");
  });

  it("logs the cause when sign-in fails (e.g. Supabase per-IP rate limit)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSignIn.mockResolvedValueOnce({
      data: { session: null },
      error: { status: 429, message: "Request rate limit reached" },
    });
    const { AnonymousSessionStore } = await import("../anonymous.js");
    const result = await new AnonymousSessionStore().getOrCreate("session-rl");
    expect(result).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("429");
    expect(String(logged.mock.calls[0][0])).toContain("Request rate limit reached");
  });

  it("returns null when Supabase sign-in fails", async () => {
    mockSignIn.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "service unavailable" },
    });
    const { AnonymousSessionStore } = await import("../anonymous.js");
    const store = new AnonymousSessionStore();
    const result = await store.getOrCreate("session-fail");
    expect(result).toBeNull();
  });

  it("re-creates session when cached JWT is expired", async () => {
    mockSignIn
      .mockResolvedValueOnce({
        data: { session: { access_token: "eyJexpired", expires_in: 0 } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { session: { access_token: "eyJfresh", expires_in: 3600 } },
        error: null,
      });
    const { AnonymousSessionStore } = await import("../anonymous.js");
    const store = new AnonymousSessionStore();
    await store.getOrCreate("session-ttl");
    // Wait a tick so the 0-second TTL expires
    await new Promise(r => setTimeout(r, 10));
    const result = await store.getOrCreate("session-ttl");
    expect(result).toBe("eyJfresh");
    expect(mockSignIn).toHaveBeenCalledTimes(2);
  });
});
