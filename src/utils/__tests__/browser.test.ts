import { describe, it, expect, vi, beforeEach } from "vitest";
import { openBrowser } from "../browser.js";
import * as childProcess from "node:child_process";

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], callback: (e: Error | null) => void) => {
    callback(null);
    return {} as any;
  }),
}));

const AUTHORIZE_URL = "https://glassypic.com/mcp/authorize?code=ABCD-7X4K-M2P9";

describe("openBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(childProcess.execFile).mockImplementation(
      ((_cmd: string, _args: string[], callback: (e: Error | null) => void) => {
        callback(null);
        return {} as any;
      }) as any,
    );
  });

  it("uses 'open' with an argv array on darwin", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser(AUTHORIZE_URL)).resolves.toBe(true);
    expect(childProcess.execFile).toHaveBeenCalledWith("open", [AUTHORIZE_URL], expect.any(Function));
  });

  it("uses 'xdg-open' on linux", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    await openBrowser(AUTHORIZE_URL);
    expect(childProcess.execFile).toHaveBeenCalledWith("xdg-open", [AUTHORIZE_URL], expect.any(Function));
  });

  it("uses rundll32 on win32, never 'start'", async () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    await openBrowser(AUTHORIZE_URL);
    expect(childProcess.execFile).toHaveBeenCalledWith(
      "rundll32",
      ["url.dll,FileProtocolHandler", AUTHORIZE_URL],
      expect.any(Function),
    );
  });

  it("resolves false when execFile errors — a genuine async assertion", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    vi.mocked(childProcess.execFile).mockImplementation(
      ((_cmd: string, _args: string[], callback: (e: Error | null) => void) => {
        setTimeout(() => callback(new Error("fail")), 0);
        return {} as any;
      }) as any,
    );
    await expect(openBrowser(AUTHORIZE_URL)).resolves.toBe(false);
  });

  it("accepts an app subdomain of an owned host", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser("https://app.glassypic.com/mcp")).resolves.toBe(true);
  });

  it("rejects a non-owned https host without spawning", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser("https://evil.example/harvest")).resolves.toBe(false);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("rejects a lookalike suffix host", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser("https://notglassypic.com/x")).resolves.toBe(false);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("rejects file: without spawning", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser("file:///etc/passwd")).resolves.toBe(false);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("rejects javascript: without spawning", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser("javascript:alert(1)")).resolves.toBe(false);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL without spawning", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser("not a url")).resolves.toBe(false);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("rejects an http downgrade of an owned host", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser("http://glassypic.com/mcp/authorize")).resolves.toBe(false);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("accepts http localhost only when allowLoopback is true", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser("http://localhost:3000/mcp/authorize", true)).resolves.toBe(true);
    await expect(openBrowser("http://localhost:3000/mcp/authorize")).resolves.toBe(false);
  });

  it("rejects a userinfo trick where the real host is not owned", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser("https://glassypic.com@evil.test/")).resolves.toBe(false);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("rejects a multi-label squat on the owned host", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    await expect(openBrowser("https://glassypic.com.evil.test/")).resolves.toBe(false);
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });
});
