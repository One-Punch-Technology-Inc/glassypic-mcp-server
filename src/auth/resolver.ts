import { verifySupabaseJwt } from "./jwt.js";

/**
 * Given an Authorization header value from an HTTP request, returns the auth headers to
 * forward to api.glassypic.com.
 *
 * Priority:
 *   1. Bearer mcp_... → pass through as-is (existing mcp_tokens)
 *   2. Bearer eyJ... → validate Supabase JWT → pass through if valid
 *   3. No/invalid auth → {} (a guest; see auth/guest.ts — the API creates the guest session
 *      on first upload and the session's token is sent as X-Session-Token from then on)
 */
export async function resolveAuthHeaders(
  authorizationHeader: string | null
): Promise<Record<string, string>> {
  if (authorizationHeader) {
    const token = authorizationHeader.replace(/^Bearer\s+/i, "");

    // mcp_ tokens: forward as-is, no validation needed here
    if (token.startsWith("mcp_")) {
      return { Authorization: `Bearer ${token}` };
    }

    // Supabase JWT: validate, then forward
    if (token.startsWith("eyJ")) {
      const payload = await verifySupabaseJwt(token);
      if (payload) return { Authorization: `Bearer ${token}` };
      // Invalid JWT — treated as a guest
    }
  }

  return {};
}
