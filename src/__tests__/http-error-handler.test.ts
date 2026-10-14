import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { jsonRpcErrorHandler } from "../transport/http.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  app.post("/mcp", (_req, res) => res.json({ ok: true }));
  app.post("/boom", () => {
    throw new Error("secret internal detail /app/src/x.ts");
  });
  app.use(jsonRpcErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const post = (path: string, body: string) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

describe("jsonRpcErrorHandler", () => {
  it("answers malformed JSON with a JSON-RPC -32700 parse error", async () => {
    const res = await post("/mcp", '{"jsonrpc": "2.0", "id": 1, "method": ');
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" },
    });
  });

  it("answers an oversized body with 413 and no stack trace", async () => {
    const res = await post("/mcp", JSON.stringify({ pad: "x".repeat(5000) }));
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(text).not.toContain("at ");
    expect(JSON.parse(text).error.code).toBe(-32600);
  });

  it("hides unexpected error details behind a generic -32603", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post("/boom", "{}");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("/app/src");
    expect(JSON.parse(text).error).toEqual({ code: -32603, message: "Internal error" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("leaves valid requests untouched", async () => {
    const res = await post("/mcp", "{}");
    expect(res.status).toBe(200);
  });
});
