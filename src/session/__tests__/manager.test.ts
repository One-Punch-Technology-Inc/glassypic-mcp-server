import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SessionManager } from "../manager.js";

describe("SessionManager", () => {
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glassypic-test-"));
    manager = new SessionManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when no session exists", () => {
    expect(manager.getToken()).toBeNull();
  });

  it("saves and retrieves a session token", () => {
    manager.saveToken("test-token-123");
    expect(manager.getToken()).toBe("test-token-123");
  });

  it("persists token to disk", () => {
    manager.saveToken("persist-token");
    const newManager = new SessionManager(tmpDir);
    expect(newManager.getToken()).toBe("persist-token");
  });

  it("overwrites existing token", () => {
    manager.saveToken("old-token");
    manager.saveToken("new-token");
    expect(manager.getToken()).toBe("new-token");
  });

  it("handles corrupted session file gracefully", () => {
    const sessionFile = path.join(tmpDir, "session.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(sessionFile, "not-json{{{");
    expect(manager.getToken()).toBeNull();
  });

  it("uses ~/.glassypic as default directory", () => {
    const defaultManager = new SessionManager();
    const expectedDir = path.join(os.homedir(), ".glassypic");
    expect(defaultManager.sessionDir).toBe(expectedDir);
  });
});

describe("mcp_token", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glassypic-test-mcp-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null mcpToken when not set", () => {
    const mgr = new SessionManager(tmpDir);
    mgr.saveToken("guest_abc");
    expect(mgr.getMcpToken()).toBeNull();
  });

  it("saves and retrieves mcp_token", () => {
    const mgr = new SessionManager(tmpDir);
    mgr.saveMcpToken("mcp_abc123", "user@email.com", "pro");
    expect(mgr.getMcpToken()).toBe("mcp_abc123");
  });

  it("preserves session_token when saving mcp_token", () => {
    const mgr = new SessionManager(tmpDir);
    mgr.saveToken("guest_abc");
    mgr.saveMcpToken("mcp_abc123", "user@email.com", "pro");
    expect(mgr.getToken()).toBe("guest_abc");
    expect(mgr.getMcpToken()).toBe("mcp_abc123");
  });

  it("clears mcp_token on clearMcpToken", () => {
    const mgr = new SessionManager(tmpDir);
    mgr.saveToken("guest_abc");
    mgr.saveMcpToken("mcp_abc123", "user@email.com", "pro");
    mgr.clearMcpToken();
    expect(mgr.getMcpToken()).toBeNull();
    expect(mgr.getToken()).toBe("guest_abc");
  });

  it("getAuthHeaders returns Bearer for mcp_token", () => {
    const mgr = new SessionManager(tmpDir);
    mgr.saveMcpToken("mcp_abc123", "user@email.com", "pro");
    const headers = mgr.getAuthHeaders();
    expect(headers).toEqual({ Authorization: "Bearer mcp_abc123" });
  });

  it("getAuthHeaders returns X-Session-Token for guest", () => {
    const mgr = new SessionManager(tmpDir);
    mgr.saveToken("guest_abc");
    const headers = mgr.getAuthHeaders();
    expect(headers).toEqual({ "X-Session-Token": "guest_abc" });
  });

  it("getAuthHeaders returns empty object when no tokens", () => {
    const mgr = new SessionManager(tmpDir);
    const headers = mgr.getAuthHeaders();
    expect(headers).toEqual({});
  });
});
