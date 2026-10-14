import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface SessionData {
  session_token: string;
  mcp_token?: string;
  user_email?: string;
  user_tier?: string;
}

export class SessionManager {
  public readonly sessionDir: string;
  private readonly sessionFile: string;
  // Legacy ~/.tinify/session.json. Read-only fallback so users logged in before
  // the GlassyPic rename are not silently logged out. Only active in default mode
  // (null when a custom sessionDir is injected, e.g. tests).
  private readonly legacySessionFile: string | null;

  constructor(sessionDir?: string) {
    // Only an omitted argument is "default mode". An explicit value — including
    // "" — is a custom dir and must NOT trigger legacy ~/.tinify migration (that
    // would write real credentials to a relative ./session.json).
    const isDefault = sessionDir === undefined;
    this.sessionDir = isDefault ? path.join(os.homedir(), ".glassypic") : sessionDir;
    this.sessionFile = path.join(this.sessionDir, "session.json");
    this.legacySessionFile = isDefault
      ? path.join(os.homedir(), ".tinify", "session.json")
      : null;
  }

  private parseFile(file: string): SessionData | null {
    try {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch {
      return null;
    }
  }

  private readData(): SessionData | null {
    const current = this.parseFile(this.sessionFile);
    if (current) return current;

    // New file absent — migrate a legacy ~/.tinify session forward, once, so the
    // rename doesn't log existing users out. After this, reads/writes use the new
    // path and the old file is removed.
    if (this.legacySessionFile) {
      const legacy = this.parseFile(this.legacySessionFile);
      if (legacy) {
        this.writeData(legacy);
        try {
          fs.rmSync(this.legacySessionFile);
        } catch {
          // best effort — a leftover legacy file is harmless (new path now wins)
        }
        return legacy;
      }
    }
    return null;
  }

  private writeData(data: SessionData): void {
    // 0700 dir + write-then-rename: `mode` on writeFileSync only applies when the file is
    // created, and a crash mid-write would otherwise leave a truncated session.json.
    fs.mkdirSync(this.sessionDir, { recursive: true, mode: 0o700 });
    const tempFile = `${this.sessionFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tempFile, this.sessionFile);
  }

  getToken(): string | null {
    return this.readData()?.session_token ?? null;
  }

  saveToken(token: string): void {
    const existing = this.readData();
    this.writeData({ ...existing, session_token: token } as SessionData);
  }

  getMcpToken(): string | null {
    return this.readData()?.mcp_token ?? null;
  }

  saveMcpToken(token: string, email: string, tier: string): void {
    const existing = this.readData();
    this.writeData({
      ...existing,
      session_token: existing?.session_token ?? "",
      mcp_token: token,
      user_email: email,
      user_tier: tier,
    });
  }

  clearMcpToken(): void {
    const existing = this.readData();
    if (existing) {
      const { mcp_token, user_email, user_tier, ...rest } = existing;
      this.writeData(rest as SessionData);
    }
  }

  getAuthHeaders(): Record<string, string> {
    const data = this.readData();
    if (data?.mcp_token) {
      return { Authorization: `Bearer ${data.mcp_token}` };
    }
    if (data?.session_token) {
      return { "X-Session-Token": data.session_token };
    }
    return {};
  }
}
