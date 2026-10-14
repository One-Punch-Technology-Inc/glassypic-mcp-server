import { ApiError } from "./client.js";

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verify_url: string;
}

export interface TokenPollResponse {
  status: "pending" | "approved" | "expired" | "denied";
  mcp_token?: string;
  user?: {
    email: string;
    tier: string;
    credits_remaining: number;
    credits_limit: number;
    credits_reset_at: string | null;
  };
}

export interface AccountStatus {
  logged_in: boolean;
  email?: string;
  tier: string;
  credits_remaining: number;
  credits_limit: number;
  credits_reset_at: string | null;
}

export async function requestDeviceCode(baseUrl: string): Promise<DeviceCodeResponse> {
  const response = await fetch(`${baseUrl}/mcp/auth/device-code`, { method: "POST" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.detail || "Failed to create device code", response.status);
  }
  return response.json();
}

export async function pollForToken(baseUrl: string, deviceCode: string): Promise<TokenPollResponse> {
  const response = await fetch(`${baseUrl}/mcp/auth/token?device_code=${encodeURIComponent(deviceCode)}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.detail || "Token poll failed", response.status);
  }
  return response.json();
}

export async function revokeToken(baseUrl: string, mcpToken: string): Promise<void> {
  const response = await fetch(`${baseUrl}/mcp/auth/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${mcpToken}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.detail || "Token revocation failed", response.status);
  }
}

export async function getAccountStatus(
  baseUrl: string,
  authHeaders: Record<string, string>,
): Promise<AccountStatus> {
  const response = await fetch(`${baseUrl}/mcp/auth/status`, { headers: authHeaders });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.detail || "Status check failed", response.status);
  }
  return response.json();
}
