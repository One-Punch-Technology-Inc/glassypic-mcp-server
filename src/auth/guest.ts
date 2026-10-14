/**
 * Guest identity for the remote (HTTP) MCP server.
 *
 * A guest has no Supabase account. The first upload without credentials makes the API create
 * a guest session and return its `session_token`; every later call for the same MCP session
 * sends it back as `X-Session-Token` — the same mechanism the local stdio client keeps in
 * ~/.glassypic/session.json. Tokens live in memory, keyed by MCP session ID, and are dropped
 * when that session closes.
 *
 * This replaces minting a Supabase anonymous user per session, which cannot work here: the
 * project has CAPTCHA protection on, and a server cannot supply a captcha token, so every
 * `signInAnonymously()` was rejected with a 400.
 *
 * Lifecycle: the transport calls `begin()` when a session starts and `delete()` when it
 * closes. Only an open session can hold a token or run queued work, so an upload that finishes
 * after its session closed cannot resurrect an entry that nothing will ever clean up.
 */
const openSessions = new Set<string>();
const tokens = new Map<string, string>();
const queues = new Map<string, Promise<unknown>>();

export const guestSessions = {
  /** Mark an MCP session as open. Until then it can hold no token. */
  begin(sessionId: string): void {
    openSessions.add(sessionId);
  },

  get(sessionId: string): string | null {
    return tokens.get(sessionId) ?? null;
  },

  /** Stores a token for an open session. Returns false (and stores nothing) if it is closed. */
  set(sessionId: string, token: string): boolean {
    if (!openSessions.has(sessionId)) return false;
    tokens.set(sessionId, token);
    return true;
  },

  /** Close a session: forget its token and stop any queued work from running. */
  delete(sessionId: string): void {
    openSessions.delete(sessionId);
    tokens.delete(sessionId);
    queues.delete(sessionId);
  },

  /**
   * Runs `task` after every earlier task for the same session has settled. The first upload of
   * a session is what creates its guest identity, so concurrent first calls must go one at a
   * time: the second then finds the token the first stored instead of creating its own guest
   * session (which would split credits and job ownership across identities). A task that was
   * still queued when its session closed does not run; it rejects instead.
   */
  async runExclusive<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const guarded = () => {
      if (!openSessions.has(sessionId)) {
        throw new Error("MCP session closed before this request could run.");
      }
      return task();
    };
    const previous = queues.get(sessionId) ?? Promise.resolve();
    const run = previous.then(guarded, guarded);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    queues.set(sessionId, tail);
    try {
      return await run;
    } finally {
      if (queues.get(sessionId) === tail) queues.delete(sessionId);
    }
  },
};
