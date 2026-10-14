import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { guestSessions } from "../guest.js";
import { requestContext } from "../context.js";
import { getAuthHeaders } from "../../api/client.js";

const SESSION = "session-guest-test";
const OTHER = "another-session";

beforeEach(() => {
  guestSessions.begin(SESSION);
});

afterEach(() => {
  guestSessions.delete(SESSION);
  guestSessions.delete(OTHER);
});

describe("guestSessions store", () => {
  it("stores, reads and forgets a token per session", () => {
    expect(guestSessions.get(SESSION)).toBeNull();
    expect(guestSessions.set(SESSION, "tok-1")).toBe(true);
    expect(guestSessions.get(SESSION)).toBe("tok-1");
    expect(guestSessions.get(OTHER)).toBeNull();
    guestSessions.delete(SESSION);
    expect(guestSessions.get(SESSION)).toBeNull();
  });

  it("refuses to store a token for a session that was never opened", () => {
    expect(guestSessions.set("never-opened", "tok")).toBe(false);
    expect(guestSessions.get("never-opened")).toBeNull();
  });

  it("cannot resurrect a token after the session closed (late upload)", () => {
    guestSessions.set(SESSION, "tok-1");
    guestSessions.delete(SESSION); // transport closed
    // An upload that was still in flight finishes and tries to store its token:
    expect(guestSessions.set(SESSION, "late-token")).toBe(false);
    expect(guestSessions.get(SESSION)).toBeNull();
  });
});

describe("runExclusive", () => {
  it("runs tasks for one session strictly one at a time, in order", async () => {
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      events.push(`end ${name}`);
      return name;
    };
    const results = await Promise.all([
      guestSessions.runExclusive(SESSION, task("a", 20)),
      guestSessions.runExclusive(SESSION, task("b", 1)),
      guestSessions.runExclusive(SESSION, task("c", 1)),
    ]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("lets a queued task see the token stored by the one before it", async () => {
    const seen: Array<string | null> = [];
    const first = guestSessions.runExclusive(SESSION, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      guestSessions.set(SESSION, "minted-once");
      seen.push(guestSessions.get(SESSION));
    });
    const second = guestSessions.runExclusive(SESSION, async () => {
      seen.push(guestSessions.get(SESSION));
    });
    await Promise.all([first, second]);
    expect(seen).toEqual(["minted-once", "minted-once"]);
  });

  it("keeps going after a task throws, and still surfaces the error to its caller", async () => {
    const failing = guestSessions.runExclusive(SESSION, async () => {
      throw new Error("upload failed");
    });
    const after = guestSessions.runExclusive(SESSION, async () => "ran");
    await expect(failing).rejects.toThrow("upload failed");
    await expect(after).resolves.toBe("ran");
  });

  it("does not block different sessions on each other", async () => {
    guestSessions.begin(OTHER);
    let releaseSlow!: () => void;
    const slow = guestSessions.runExclusive(
      SESSION,
      () => new Promise<void>((resolve) => (releaseSlow = resolve)),
    );
    expect(await guestSessions.runExclusive(OTHER, async () => "done")).toBe("done");
    releaseSlow();
    await slow;
  });

  it("does not run queued work once the session has closed", async () => {
    let releaseFirst!: () => void;
    let queuedRan = false;
    const first = guestSessions.runExclusive(
      SESSION,
      () => new Promise<void>((resolve) => (releaseFirst = resolve)),
    );
    const queued = guestSessions.runExclusive(SESSION, async () => {
      queuedRan = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 0)); // let the first task actually start
    guestSessions.delete(SESSION); // the MCP session closes while one task is running, one queued
    releaseFirst();

    await first;
    await expect(queued).rejects.toThrow(/session closed/i);
    expect(queuedRan).toBe(false);
  });

  it("rejects new work for a session that is not open", async () => {
    guestSessions.delete(SESSION);
    await expect(guestSessions.runExclusive(SESSION, async () => "x")).rejects.toThrow(
      /session closed/i,
    );
  });
});

describe("getAuthHeaders in a remote (HTTP) request", () => {
  it("returns Authorization when the caller authenticated", () => {
    const headers = requestContext.run(
      { authHeaders: { Authorization: "Bearer mcp_x" }, sessionId: SESSION },
      () => getAuthHeaders(),
    );
    expect(headers).toEqual({ Authorization: "Bearer mcp_x" });
  });

  it("returns nothing for a guest with no guest session yet", () => {
    const headers = requestContext.run({ authHeaders: {}, sessionId: SESSION }, () => getAuthHeaders());
    expect(headers).toEqual({});
  });

  it("returns X-Session-Token once the session has a guest token", () => {
    guestSessions.set(SESSION, "guest-token-123");
    const headers = requestContext.run({ authHeaders: {}, sessionId: SESSION }, () => getAuthHeaders());
    expect(headers).toEqual({ "X-Session-Token": "guest-token-123" });
  });

  it("keeps guests of different MCP sessions separate", () => {
    guestSessions.set(SESSION, "token-A");
    const other = requestContext.run({ authHeaders: {}, sessionId: OTHER }, () => getAuthHeaders());
    expect(other).toEqual({});
  });
});
