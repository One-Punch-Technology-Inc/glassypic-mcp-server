import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const SERVER_VERSION: string = (_require("../../package.json") as { version: string }).version;
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveAuthHeaders } from "../auth/resolver.js";
import { requestContext } from "../auth/context.js";
import { resolveApiBaseUrl } from "../api/client.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastActivity: number;
}

const MAX_SESSIONS = 10_000;
const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0", id: null, error: { code, message } };
}

/**
 * Terminal Express error handler. Without it, errors thrown by `express.json()` (malformed
 * or oversized bodies) fall through to Express's default handler, which answers with an HTML
 * page and, when NODE_ENV is not "production", a stack trace with server file paths.
 * MCP clients expect a JSON-RPC error envelope instead. Must keep four parameters or
 * Express will not treat it as an error handler.
 */
export function jsonRpcErrorHandler(
  err: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const errorType = (err as { type?: string } | null)?.type;
  if (errorType === "entity.parse.failed") {
    res.status(400).json(jsonRpcError(-32700, "Parse error"));
    return;
  }
  if (errorType === "entity.too.large") {
    res.status(413).json(jsonRpcError(-32600, "Request too large"));
    return;
  }
  // Log the real error server-side; never put it in the response.
  console.error("Unhandled HTTP error:", err);
  res.status(500).json(jsonRpcError(-32603, "Internal error"));
}

/**
 * Starts the HTTP server for remote MCP.
 * @param createServer Factory that creates a new McpServer with tools registered.
 *                     Called once per session (each client gets its own server instance).
 */
export async function startHttpServer(createServer: () => McpServer): Promise<void> {
  // Fail fast on a malformed deployment secret rather than at first tool call.
  resolveApiBaseUrl();

  const app = express();
  app.use(express.json());

  const sessions = new Map<string, Session>();

  // Periodic cleanup: remove idle sessions every 5 minutes
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivity > SESSION_IDLE_MS) {
        session.transport.close();
        sessions.delete(id);
      }
    }
  }, 5 * 60 * 1000);

  // CORS for discovery endpoints (browser-based clients)
  app.use("/.well-known", cors());

  // OAuth discovery proxy — MCP clients auto-fetch this to discover auth endpoints
  app.get("/.well-known/oauth-authorization-server", async (_req, res) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) {
      res.status(503).json({ error: "OAuth not configured" });
      return;
    }
    try {
      const upstream = await fetch(
        `${supabaseUrl}/.well-known/oauth-authorization-server/auth/v1`
      );
      const data = await upstream.json();
      res.json(data);
    } catch {
      res.status(502).json({ error: "Failed to fetch OAuth metadata" });
    }
  });

  // Static MCP server card — allows Smithery to scan tools without auth
  app.get("/.well-known/mcp/server-card.json", (_req, res) => {
    res.json({
      serverInfo: { name: "glassypic", version: SERVER_VERSION },
      authentication: { schemes: ["bearer"], required: false },
    });
  });

  // Health check
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // MCP endpoint — POST (requests), GET (SSE stream), DELETE (session end)
  app.all("/mcp", async (req, res) => {
    const authHeader = req.headers.authorization ?? null;
    const existingSessionId = req.headers["mcp-session-id"] as string | undefined;

    // --- Existing session: reuse transport ---
    if (existingSessionId && sessions.has(existingSessionId)) {
      const session = sessions.get(existingSessionId)!;
      session.lastActivity = Date.now();

      if (req.method === "DELETE") {
        session.transport.close();
        sessions.delete(existingSessionId);
        res.status(200).end();
        return;
      }

      const authHeaders = await resolveAuthHeaders(authHeader, existingSessionId);
      try {
        await requestContext.run({ authHeaders, sessionId: existingSessionId }, async () => {
          await session.transport.handleRequest(req as any, res as any, req.body);
        });
      } catch {
        session.transport.close();
        sessions.delete(existingSessionId);
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error" });
        }
      }
      return;
    }

    // --- Existing session ID but not found: 404 ---
    if (existingSessionId && !sessions.has(existingSessionId)) {
      res.status(404).json({ error: "Session not found or expired" });
      return;
    }

    // --- New session: create transport + server ---
    // Evict oldest session if at capacity (LRU)
    if (sessions.size >= MAX_SESSIONS) {
      let oldestId: string | null = null;
      let oldestTime = Infinity;
      for (const [id, s] of sessions) {
        if (s.lastActivity < oldestTime) {
          oldestTime = s.lastActivity;
          oldestId = id;
        }
      }
      if (oldestId) {
        sessions.get(oldestId)?.transport.close();
        sessions.delete(oldestId);
      }
    }

    // Pre-generate the session ID so the transport, anonStore, and sessions Map all share the same key.
    // Without this, the anonStore would cache the anonymous JWT under a temp UUID that differs from
    // transport.sessionId, causing a cache miss on every subsequent request.
    const sessionId = randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
    });

    const server = createServer();
    await server.connect(transport);

    const authHeaders = await resolveAuthHeaders(authHeader, sessionId);

    try {
      await requestContext.run({ authHeaders, sessionId }, async () => {
        await transport.handleRequest(req as any, res as any, req.body);
      });
    } catch {
      transport.close();
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
      return;
    }

    // Store session after init completes
    sessions.set(sessionId, {
      transport,
      server,
      lastActivity: Date.now(),
    });
  });

  // Must be registered after all routes
  app.use(jsonRpcErrorHandler);

  // Graceful shutdown
  const port = parseInt(process.env.PORT ?? "8080", 10);
  const httpServer = app.listen(port, () => {
    console.error(`GlassyPic MCP server listening on port ${port} (HTTP mode)`);
  });

  const shutdown = () => {
    console.error("Shutting down: closing active sessions...");
    clearInterval(cleanupTimer);
    for (const [id, session] of sessions) {
      session.transport.close();
      sessions.delete(id);
    }
    httpServer.close();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
