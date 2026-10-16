import { resolveApiBaseUrl, getAuthHeaders } from "../api/client.js";
import { getAccountStatus } from "../api/auth.js";

export async function statusTool(): Promise<string> {
  const { baseUrl } = resolveApiBaseUrl();
  const authHeaders = getAuthHeaders();
  const status = await getAccountStatus(baseUrl, authHeaders);

  if (status.logged_in) {
    const resetInfo = status.credits_reset_at
      ? `Resets: ${formatResetTime(status.credits_reset_at)}`
      : "";
    return [
      `Logged in as ${status.email} (${capitalize(status.tier)} tier)`,
      `Credits: ${status.credits_remaining.toLocaleString()} of ${status.credits_limit.toLocaleString()} remaining`,
      resetInfo,
    ].filter(Boolean).join("\n");
  }

  return [
    "Not logged in. Using guest session.",
    `Credits: ${status.credits_remaining} of ${status.credits_limit} remaining (resets daily)`,
    "Tip: Log in for more credits.",
  ].join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatResetTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}
