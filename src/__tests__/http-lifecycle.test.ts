import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createServer as createNetServer } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../auth/resolver.js", () => ({ resolveAuthHeaders: async () => ({}) }));

import { startHttpServer } from "../transport/http.js";

const MAX = 2;
const servers: McpServer[] = [];
let handlerStarted: () => void = () => {};
let handlerAborted = false;

// A tool that blocks until the SDK aborts it, so we can observe transport cleanup.
const createServer = () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  server.registerTool("slow", { description: "blocks until aborted", inputSchema: {} }, async (_args, extra) => {
    handlerStarted();
    await new Promise<void>((resolve) =>
      extra.signal.addEventListener("abort", () => {
        handlerAborted = true;
        resolve();
      }),
    );
    return { content: [{ type: "text" as const, text: "aborted" }] };
  });
  servers.push(server);
  return server;
};

let baseUrl: string;
const liveSessions: string[] = [];

const HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } },
};

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

async function openSession(): Promise<string> {
  const res = await fetch(`${baseUrl}/mcp`, { method: "POST", headers: HEADERS, body: JSON.stringify(INIT) });
  await res.text();
  const id = res.headers.get("mcp-session-id");
  expect(id).toBeTruthy();
  liveSessions.push(id!);
  return id!;
}

const listTools = (sessionId: string) =>
  fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { ...HEADERS, "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  }).then(async (res) => {
    await res.text();
    return res.status;
  });

beforeAll(async () => {
  const port = await freePort();
  process.env.PORT = String(port);
  process.env.MCP_MAX_SESSIONS = String(MAX);
  vi.spyOn(console, "error").mockImplementation(() => {});
  await startHttpServer(createServer);
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const id of liveSessions.splice(0)) {
    await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: { ...HEADERS, "mcp-session-id": id } });
  }
  handlerAborted = false;
  servers.length = 0;
});

afterAll(() => {
  process.emit("SIGTERM");
  delete process.env.MCP_MAX_SESSIONS;
});

describe("session eviction", () => {
  it("evicts the least-recently-used session at capacity and runs SDK cleanup on it", async () => {
    const oldest = await openSession();
    const newer = await openSession();
    expect(await listTools(newer)).toBe(200); // touch `newer` so `oldest` is the LRU
    const evictedServer = servers[0];
    expect(evictedServer.server.transport).toBeDefined();

    const incoming = await openSession();

    expect(await listTools(oldest)).toBe(404);
    expect(await listTools(newer)).toBe(200);
    expect(await listTools(incoming)).toBe(200);
    // Protocol's own onclose cleanup ran: the evicted server let go of its transport.
    expect(evictedServer.server.transport).toBeUndefined();
  });

  it("does not evict anyone when initialize fails validation at capacity", async () => {
    const a = await openSession();
    const b = await openSession();

    const rejected = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" }, // missing text/event-stream
      body: JSON.stringify(INIT),
    });
    await rejected.text();
    expect(rejected.status).toBe(406);

    expect(await listTools(a)).toBe(200);
    expect(await listTools(b)).toBe(200);
  });
});

describe("transport cleanup", () => {
  it("aborts an in-flight tool call when the session is closed", async () => {
    const id = await openSession();
    const started = new Promise<void>((resolve) => (handlerStarted = resolve));
    const client = new AbortController();

    const pending = fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { ...HEADERS, "mcp-session-id": id },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "slow", arguments: {} } }),
      signal: client.signal,
    }).catch(() => undefined);

    await started;
    expect(handlerAborted).toBe(false);

    const end = await fetch(`${baseUrl}/mcp`, { method: "DELETE", headers: { ...HEADERS, "mcp-session-id": id } });
    expect(end.status).toBe(200);
    liveSessions.splice(liveSessions.indexOf(id), 1);

    await vi.waitFor(() => expect(handlerAborted).toBe(true), { timeout: 2000 });
    client.abort();
    await pending;
  });
});
