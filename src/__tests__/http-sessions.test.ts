import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer as createNetServer } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// No Supabase in tests: anonymous-session minting is not what is under test here.
const { resolveAuthHeaders } = vi.hoisted(() => ({
  resolveAuthHeaders: vi.fn(async () => ({})),
}));
vi.mock("../auth/resolver.js", () => ({ resolveAuthHeaders }));

import {
  startHttpServer,
  resolveMaxSessions,
  originGuard,
  parseAllowedOrigins,
  requestNeedsAuth,
} from "../transport/http.js";

const createServer = vi.fn(() => new McpServer({ name: "test", version: "0.0.0" }));
let baseUrl: string;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};

beforeAll(async () => {
  const port = await freePort();
  process.env.PORT = String(port);
  vi.spyOn(console, "error").mockImplementation(() => {});
  await startHttpServer(createServer);
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  // startHttpServer's shutdown handler clears its timer and closes the listener.
  process.emit("SIGTERM");
});

describe("session creation", () => {
  it("rejects a non-initialize POST without a session and allocates nothing", async () => {
    createServer.mockClear();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(-32000);
    expect(createServer).not.toHaveBeenCalled();
  });

  it("rejects GET and DELETE without a session and allocates nothing", async () => {
    createServer.mockClear();
    for (const method of ["GET", "DELETE"]) {
      const res = await fetch(`${baseUrl}/mcp`, { method, headers: MCP_HEADERS });
      expect(res.status).toBe(400);
    }
    expect(createServer).not.toHaveBeenCalled();
  });

  it("creates a session for a valid initialize and lets the client end it", async () => {
    createServer.mockClear();
    const init = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(INITIALIZE_BODY),
    });
    expect(init.status).toBe(200);
    const sessionId = init.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    expect(createServer).toHaveBeenCalledTimes(1);
    await init.text();

    const end = await fetch(`${baseUrl}/mcp`, {
      method: "DELETE",
      headers: { ...MCP_HEADERS, "mcp-session-id": sessionId! },
    });
    expect(end.status).toBe(200);

    const after = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...MCP_HEADERS, "mcp-session-id": sessionId! },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(after.status).toBe(404);
  });
});

describe("lazy auth resolution (protects the Supabase anonymous sign-in quota)", () => {
  it("requestNeedsAuth is true only for tools/call, including inside a batch", () => {
    expect(requestNeedsAuth({ method: "tools/call" })).toBe(true);
    expect(requestNeedsAuth([{ method: "tools/list" }, { method: "tools/call" }])).toBe(true);
    for (const method of ["initialize", "tools/list", "ping", "notifications/initialized"]) {
      expect(requestNeedsAuth({ method })).toBe(false);
    }
    expect(requestNeedsAuth(undefined)).toBe(false);
    expect(requestNeedsAuth(null)).toBe(false);
  });

  it("resolves auth for tools/call only — not for initialize or tools/list", async () => {
    resolveAuthHeaders.mockClear();
    const init = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(INITIALIZE_BODY),
    });
    const sessionId = init.headers.get("mcp-session-id")!;
    await init.text();
    const sessionHeaders = { ...MCP_HEADERS, "mcp-session-id": sessionId };

    const list = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    await list.text();
    expect(resolveAuthHeaders).not.toHaveBeenCalled();

    // An unknown tool is rejected by the SDK before any API call, but auth is still resolved.
    const call = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "no_such_tool", arguments: {} },
      }),
    });
    await call.text();
    expect(resolveAuthHeaders).toHaveBeenCalledTimes(1);

    await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: sessionHeaders });
  });
});

describe("resolveMaxSessions", () => {
  it("defaults to 2000 and accepts a positive integer override", () => {
    expect(resolveMaxSessions({})).toBe(2000);
    expect(resolveMaxSessions({ MCP_MAX_SESSIONS: "500" })).toBe(500);
  });

  it("ignores junk, zero, negatives and fractions", () => {
    for (const bad of ["", "abc", "0", "-5", "1.5", "NaN"]) {
      expect(resolveMaxSessions({ MCP_MAX_SESSIONS: bad })).toBe(2000);
    }
  });
});

describe("origin guard", () => {
  const run = (allowed: string[], origin?: string) => {
    const res = { statusCode: 200, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    const next = vi.fn();
    originGuard(allowed)({ headers: origin === undefined ? {} : { origin } } as any, res as any, next);
    return { res, next };
  };

  it("is a no-op when no allowlist is configured", () => {
    expect(run([], "https://evil.example").next).toHaveBeenCalled();
  });

  it("lets requests without an Origin header through (CLI / server-to-server)", () => {
    expect(run(["https://app.glassypic.com"]).next).toHaveBeenCalled();
  });

  it("allows a listed origin, ignoring a trailing slash", () => {
    expect(run(["https://app.glassypic.com"], "https://app.glassypic.com/").next).toHaveBeenCalled();
  });

  it("rejects an unlisted browser origin with 403 JSON-RPC", () => {
    const { res, next } = run(["https://app.glassypic.com"], "http://attacker.example");
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.body as any).error.message).toMatch(/origin/i);
  });

  it("parses the env list", () => {
    expect(parseAllowedOrigins(" https://a.com/ , https://b.com ,, ")).toEqual(["https://a.com", "https://b.com"]);
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe("response hardening", () => {
  it("does not advertise the framework", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.headers.get("x-powered-by")).toBeNull();
  });
});
