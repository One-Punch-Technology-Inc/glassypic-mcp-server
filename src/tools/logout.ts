import { SessionManager } from "../session/manager.js";
import { resolveApiBaseUrl } from "../api/client.js";
import { getAccountStatus, revokeToken } from "../api/auth.js";

export async function logoutTool(): Promise<string> {
  const sessionManager = new SessionManager();

  const mcpToken = sessionManager.getMcpToken();
  if (!mcpToken) {
    return "Not logged in. Already using guest session.";
  }

  // Confirm that the token still represents an authenticated account before
  // describing this as a logout. A stale token can make status report guest
  // while its mere presence would otherwise produce the logged-out wording.
  let revokeFailed = false;
  try {
    const { baseUrl } = resolveApiBaseUrl();
    const status = await getAccountStatus(baseUrl, {
      Authorization: `Bearer ${mcpToken}`,
    });
    if (!status.logged_in) {
      sessionManager.clearMcpToken();
      return "Not logged in. Already using guest session.";
    }
    await revokeToken(baseUrl, mcpToken);
  } catch {
    revokeFailed = true;
  }

  // Unconditional: a user who asks to log out must end up logged out locally,
  // even when the network is unreachable or GLASSYPIC_API_URL is invalid.
  sessionManager.clearMcpToken();

  return revokeFailed
    ? "Logged out locally, but GlassyPic could not be reached to revoke the token server-side — it remains valid until it expires. Running login again issues a new token and revokes this one. Using guest session."
    : "Logged out. Using guest session.";
}
