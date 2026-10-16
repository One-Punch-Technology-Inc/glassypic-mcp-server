import { describe, it, expect, vi, beforeEach } from "vitest";

const getMcpTokenMock = vi.hoisted(() => vi.fn());
const clearMcpTokenMock = vi.hoisted(() => vi.fn());
const getAccountStatusMock = vi.hoisted(() => vi.fn());
const revokeTokenMock = vi.hoisted(() => vi.fn());
const getAuthHeadersMock = vi.hoisted(() => vi.fn());
const resolveApiBaseUrlMock = vi.hoisted(() =>
  vi.fn(() => ({ baseUrl: "https://api.glassypic.com", isLoopback: false })),
);

vi.mock("../../session/manager.js", () => ({
  SessionManager: vi.fn(() => ({
    getMcpToken: getMcpTokenMock,
    clearMcpToken: clearMcpTokenMock,
  })),
}));

vi.mock("../../api/auth.js", () => ({
  revokeToken: revokeTokenMock,
  getAccountStatus: getAccountStatusMock,
}));

vi.mock("../../api/client.js", () => ({
  DEFAULT_BASE_URL: "https://api.glassypic.com",
  getAuthHeaders: getAuthHeadersMock,
  resolveApiBaseUrl: resolveApiBaseUrlMock,
}));

import { logoutTool } from "../logout.js";
import { statusTool } from "../status.js";

describe("logoutTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthHeadersMock.mockReturnValue({});
  });

  it("revokes and clears token when logged in", async () => {
    getMcpTokenMock.mockReturnValue("mcp_active");
    getAccountStatusMock.mockResolvedValue({ logged_in: true });
    revokeTokenMock.mockResolvedValue(undefined);

    const result = await logoutTool();

    expect(getAccountStatusMock).toHaveBeenCalledWith(
      expect.any(String),
      { Authorization: "Bearer mcp_active" },
    );
    expect(revokeTokenMock).toHaveBeenCalledWith(expect.any(String), "mcp_active");
    expect(clearMcpTokenMock).toHaveBeenCalledOnce();
    expect(result).toMatch(/logged out/i);
  });

  it("returns the precise guest message when no token exists", async () => {
    getMcpTokenMock.mockReturnValue(null);

    const result = await logoutTool();

    expect(getAccountStatusMock).not.toHaveBeenCalled();
    expect(revokeTokenMock).not.toHaveBeenCalled();
    expect(result).toBe("Not logged in. Already using guest session.");
  });
  it("clears a stale token and keeps the guest message when status says not logged in", async () => {
    getMcpTokenMock.mockReturnValue("mcp_expired");
    getAccountStatusMock.mockResolvedValue({ logged_in: false });

    const result = await logoutTool();

    expect(revokeTokenMock).not.toHaveBeenCalled();
    expect(clearMcpTokenMock).toHaveBeenCalledOnce();
    expect(result).toBe("Not logged in. Already using guest session.");
  });

  it("still clears the token locally when revokeToken throws, and warns", async () => {
    getMcpTokenMock.mockReturnValue("mcp_active");
    getAccountStatusMock.mockResolvedValue({ logged_in: true });
    revokeTokenMock.mockRejectedValue(new Error("network error"));

    const result = await logoutTool();

    expect(clearMcpTokenMock).toHaveBeenCalledOnce();
    expect(result).toMatch(/could not be reached/i);
    expect(result).toMatch(/remains valid/i);
  });

  it("returns the plain message when revocation succeeds", async () => {
    getMcpTokenMock.mockReturnValue("mcp_active");
    getAccountStatusMock.mockResolvedValue({ logged_in: true });
    revokeTokenMock.mockResolvedValue(undefined);

    const result = await logoutTool();

    expect(result).toBe("Logged out. Using guest session.");
  });

  it("still clears the token locally when resolveApiBaseUrl throws on a malformed GLASSYPIC_API_URL", async () => {
    getMcpTokenMock.mockReturnValue("mcp_active");
    resolveApiBaseUrlMock.mockImplementationOnce(() => {
      throw new Error("GLASSYPIC_API_URL must be a valid URL");
    });

    const result = await logoutTool();

    // Bad config must never block the local clear — the whole point of this test.
    expect(clearMcpTokenMock).toHaveBeenCalledOnce();
    expect(revokeTokenMock).not.toHaveBeenCalled();
    expect(result).toMatch(/could not be reached/i);
  });
});

describe("statusTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthHeadersMock.mockReturnValue({});
  });

  it("returns tier and credits when logged in", async () => {
    getAccountStatusMock.mockResolvedValue({
      logged_in: true,
      email: "user@example.com",
      tier: "pro",
      credits_remaining: 2500,
      credits_limit: 3000,
      credits_reset_at: null,
    });

    const result = await statusTool();

    expect(result).toContain("user@example.com");
    expect(result).toContain("Pro");
    expect(result).toContain("2,500");
  });

  it("returns 'not logged in' message when not logged in", async () => {
    getAccountStatusMock.mockResolvedValue({
      logged_in: false,
      credits_remaining: 20,
      credits_limit: 20,
    });

    const result = await statusTool();

    expect(result).toMatch(/not logged in/i);
    expect(result).toContain("20");
  });

  it("includes reset time when credits_reset_at is set", async () => {
    getAccountStatusMock.mockResolvedValue({
      logged_in: true,
      email: "user@example.com",
      tier: "free",
      credits_remaining: 40,
      credits_limit: 50,
      credits_reset_at: "2026-06-01T00:00:00Z",
    });

    const result = await statusTool();

    expect(result).toContain("Resets");
  });
});
