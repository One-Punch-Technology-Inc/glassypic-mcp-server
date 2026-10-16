import { getRequestAuthHeaders, getRequestSessionId } from "../auth/context.js";
import { guestSessions } from "../auth/guest.js";
import { SessionManager } from "../session/manager.js";

export interface ClientConfig {
  baseUrl: string;
  sessionToken: string | null;
}

export const DEFAULT_BASE_URL = "https://api.glassypic.com";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail?: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Returns auth headers for an API call.
 * In HTTP mode (request context present): uses per-request auth from context.
 * In stdio mode (no context): reads from ~/.glassypic/session.json via SessionManager.
 */
export function getAuthHeaders(): Record<string, string> {
  // HTTP mode: context is set by the transport per request
  const contextHeaders = getRequestAuthHeaders();
  if (Object.keys(contextHeaders).length > 0) return contextHeaders;

  // HTTP mode, no credentials: a guest. Use the guest session this MCP session created on its
  // first upload. Never fall through to SessionManager here — that reads the *server's* own
  // ~/.glassypic, which has nothing to do with the caller.
  const sessionId = getRequestSessionId();
  if (sessionId !== undefined) {
    const guestToken = guestSessions.get(sessionId);
    return guestToken ? { "X-Session-Token": guestToken } : {};
  }

  // stdio mode: read from local session file
  return new SessionManager().getAuthHeaders();
}

export function buildAuthHeaders(token?: string): Record<string, string> {
  if (token !== undefined) {
    const normalizedToken = token.trim();
    if (normalizedToken.length === 0) {
      throw new ApiError("Explicit auth token must not be blank.", 400);
    }
    return { "X-Session-Token": normalizedToken };
  }
  return getAuthHeaders();
}

export interface ApiBaseUrl {
  /** Normalized base URL with any trailing slash removed. */
  baseUrl: string;
  /** True when the resolved host is loopback. Consumed by openBrowser's allowLoopback. */
  isLoopback: boolean;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Resolves and validates the API base URL.
 *
 * Reads GLASSYPIC_API_URL, then falls back to the default.
 *
 * Images and a Bearer token are sent to this host, so https is required except
 * for loopback development. Validation is lazy — callers invoke it at call time
 * so a bad value surfaces as a normal MCP tool error via formatErrorForMcp
 * rather than killing the process at import.
 *
 * Mirrors apps/slack/src/config.ts:14-26.
 */
export function resolveApiBaseUrl(env: NodeJS.ProcessEnv = process.env): ApiBaseUrl {
  const raw = env.GLASSYPIC_API_URL ?? DEFAULT_BASE_URL;
  const varName = "GLASSYPIC_API_URL";

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `${varName} must be a valid URL (https, or http for localhost). Received: ${raw}`,
    );
  }

  const isLoopback = LOOPBACK_HOSTNAMES.has(parsed.hostname);
  const protocolOk = parsed.protocol === "https:" || (parsed.protocol === "http:" && isLoopback);
  if (!protocolOk) {
    throw new Error(
      `${varName} must be an https URL (http is allowed only for localhost). Received: ${raw}`,
    );
  }

  return { baseUrl: raw.replace(/\/+$/, ""), isLoopback };
}
