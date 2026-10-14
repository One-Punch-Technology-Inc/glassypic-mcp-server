import { createClient } from "@supabase/supabase-js";

interface CachedSession {
  jwt: string;
  expiresAt: number; // Unix ms
}

const MAX_CACHE_SIZE = 10_000;

/**
 * Manages anonymous Supabase sessions for unauthenticated MCP clients.
 * Each unique Mcp-Session-Id gets its own anonymous Supabase user.
 * JWTs are cached in memory with bounded LRU eviction and TTL.
 */
export class AnonymousSessionStore {
  private readonly cache = new Map<string, CachedSession>(); // sessionId → { jwt, expiresAt }
  private readonly inflight = new Map<string, Promise<string | null>>(); // sessionId → pending sign-in

  async getOrCreate(sessionId: string): Promise<string | null> {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;

    const cached = this.cache.get(sessionId);
    if (cached && cached.expiresAt > Date.now()) {
      // LRU: delete and re-insert to move to end
      this.cache.delete(sessionId);
      this.cache.set(sessionId, cached);
      return cached.jwt;
    }

    // Auth is resolved lazily (first tools/call), so a client can fire several calls at once
    // for a brand-new session. Share one in-flight sign-in per session ID: otherwise each call
    // mints its own Supabase user — splitting credits and actor-scoped jobs across identities
    // and spending extra of the per-IP anonymous sign-in quota.
    const pending = this.inflight.get(sessionId);
    if (pending) return pending;

    const signIn = this.signIn(sessionId, process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    this.inflight.set(sessionId, signIn);
    try {
      return await signIn;
    } finally {
      this.inflight.delete(sessionId);
    }
  }

  private async signIn(sessionId: string, supabaseUrl: string, anonKey: string): Promise<string | null> {
    // Fresh client per sign-in; the supabase client itself holds no shared state between calls
    const supabase = createClient(supabaseUrl, anonKey);
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session) {
      // Previously silent. A failure here (commonly Supabase's per-IP anonymous sign-in rate
      // limit) leaves the session unauthenticated, so tool calls fail later with a confusing
      // 403 — make the root cause visible in Cloud Logging.
      console.error(
        `Anonymous sign-in failed (status ${error?.status ?? "none"}): ${error?.message ?? "no session returned"}`
      );
      return null;
    }

    const jwt = data.session.access_token;
    const expiresAt = Date.now() + (data.session.expires_in ?? 3600) * 1000;

    // Evict oldest entry if at capacity (LRU — Map preserves insertion order)
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }

    this.cache.set(sessionId, { jwt, expiresAt });
    return jwt;
  }
}
