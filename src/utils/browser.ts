import { execFile } from "node:child_process";

/**
 * Hosts we are willing to hand to the user's default browser.
 *
 * The authorize URL originates server-side as `${settings.web_url}/mcp/authorize`
 * (services/api/app/services/mcp_auth.py:46), so a protocol-only allowlist would
 * still open https://evil.example/harvest if that value were ever wrong. This
 * list is what actually closes that path.
 *
 * The pre-rename domain was removed 2026-09-10: settings.web_url is glassypic.com
 * in every environment, and that domain is being transferred to a third party —
 * after which trusting it would hand their host to the user's browser.
 */
const OWNED_HOSTS = ["glassypic.com"];

function isOwnedHost(hostname: string): boolean {
  return OWNED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Validates that a URL is safe to hand to the user's default browser: a
 * parseable URL, https (or http for an explicitly allowed loopback), and
 * pointed at an owned host (or loopback).
 *
 * Exported so callers can check *before* calling openBrowser and distinguish
 * "the URL was rejected by the allowlist" (never show it to the user — do not
 * route around the allowlist by asking them to open it by hand) from "the URL
 * was fine but the browser failed to launch" (a legitimate fallback: printing
 * the URL is still useful).
 */
export function isAllowedBrowserUrl(url: string, allowLoopback = false): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const loopbackOk = allowLoopback && isLoopback(parsed.hostname);
  if (parsed.protocol !== "https:" && !(loopbackOk && parsed.protocol === "http:")) {
    return false;
  }
  if (!isOwnedHost(parsed.hostname) && !loopbackOk) {
    return false;
  }
  return true;
}

/**
 * Opens a URL in the user's default browser.
 *
 * Uses execFile with an argv array rather than exec with an interpolated string,
 * so no shell parses the URL. Resolves false — without spawning anything — for
 * any URL that fails validation (see isAllowedBrowserUrl).
 *
 * @param allowLoopback Pass true only when the resolved API base URL is itself
 *   loopback, so local development keeps working without weakening the default.
 */
export function openBrowser(url: string, allowLoopback = false): Promise<boolean> {
  if (!isAllowedBrowserUrl(url, allowLoopback)) {
    return Promise.resolve(false);
  }

  // `start` is a cmd.exe builtin, not an executable, so execFile("start", ...)
  // fails outright. Routing through `cmd /c start` would reintroduce shell
  // parsing and undo the reason for using execFile at all.
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];

  return new Promise((resolve) => execFile(cmd, args, (error) => resolve(!error)));
}
