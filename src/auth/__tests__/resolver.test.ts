import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../jwt.js", () => ({
  verifySupabaseJwt: vi.fn(),
}));

describe("resolveAuthHeaders", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("passes through valid Supabase JWT as Bearer token", async () => {
    const { verifySupabaseJwt } = await import("../jwt.js");
    vi.mocked(verifySupabaseJwt).mockResolvedValueOnce({ sub: "user-1" } as any);
    const { resolveAuthHeaders } = await import("../resolver.js");
    const result = await resolveAuthHeaders("Bearer eyJvalid.jwt");
    expect(result).toEqual({ Authorization: "Bearer eyJvalid.jwt" });
  });

  it("treats an invalid Supabase JWT as a guest (no headers)", async () => {
    const { verifySupabaseJwt } = await import("../jwt.js");
    vi.mocked(verifySupabaseJwt).mockResolvedValueOnce(null);
    const { resolveAuthHeaders } = await import("../resolver.js");
    const result = await resolveAuthHeaders("Bearer eyJbad.jwt");
    expect(result).toEqual({});
  });

  it("passes through mcp_ token without validation", async () => {
    const { resolveAuthHeaders } = await import("../resolver.js");
    const result = await resolveAuthHeaders("Bearer mcp_abc123");
    expect(result).toEqual({ Authorization: "Bearer mcp_abc123" });
  });

  it("returns no headers when there is no Authorization header (a guest)", async () => {
    const { resolveAuthHeaders } = await import("../resolver.js");
    expect(await resolveAuthHeaders(null)).toEqual({});
  });

  it("makes no network call for a guest (no anonymous Supabase user is created)", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network not allowed"));
    const { resolveAuthHeaders } = await import("../resolver.js");
    expect(await resolveAuthHeaders(null)).toEqual({});
    expect(await resolveAuthHeaders("Bearer not-a-known-token-format")).toEqual({});
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });
});
