import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveInput } from "../input.js";
import { resolveOutputPath, sanitizeFilenameStem } from "../output.js";
import { SessionManager } from "../../session/manager.js";

let workDir: string;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "glassypic-hardening-"));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("resolveInput file restrictions", () => {
  it("reads a supported image", async () => {
    const file = path.join(workDir, "photo.PNG");
    fs.writeFileSync(file, Buffer.from([1, 2, 3]));
    const result = await resolveInput(file);
    expect(result.filename).toBe("photo.PNG");
    expect(result.buffer.length).toBe(3);
  });

  it("refuses non-image files so they are never uploaded", async () => {
    const secret = path.join(workDir, "id_rsa");
    fs.writeFileSync(secret, "PRIVATE KEY");
    await expect(resolveInput(secret)).rejects.toThrow(/Unsupported file type/);
    const env = path.join(workDir, ".env");
    fs.writeFileSync(env, "TOKEN=abc");
    await expect(resolveInput(env)).rejects.toThrow(/Unsupported file type/);
  });

  it("refuses a directory with an image-like name", async () => {
    const dir = path.join(workDir, "folder.png");
    fs.mkdirSync(dir);
    await expect(resolveInput(dir)).rejects.toThrow(/Not a regular file/);
  });
});

describe("sanitizeFilenameStem / SEO filename", () => {
  it("strips path separators and traversal", () => {
    expect(sanitizeFilenameStem("../../etc/cron.d/evil")).toBe("etc-cron.d-evil");
    expect(sanitizeFilenameStem("..\\..\\win")).toBe("win");
    expect(sanitizeFilenameStem("red-running-shoes")).toBe("red-running-shoes");
    expect(sanitizeFilenameStem("///")).toBe("");
  });

  it("keeps a hostile seoFilename inside the target directory", () => {
    const resolved = resolveOutputPath({
      inputPath: path.join(workDir, "a.png"),
      isUrl: false,
      filename: "a.png",
      outputPath: undefined,
      outputFormat: "webp",
      seoFilename: "../../../../tmp/pwned",
    });
    expect(path.dirname(resolved)).toBe(workDir);
  });

  it("falls back to the polished name when nothing safe is left", () => {
    const resolved = resolveOutputPath({
      inputPath: path.join(workDir, "a.png"),
      isUrl: false,
      filename: "a.png",
      outputPath: undefined,
      outputFormat: undefined,
      seoFilename: "../",
    });
    expect(path.basename(resolved)).toBe("a.polished.png");
  });
});

describe("SessionManager file permissions", () => {
  it("writes the session dir 0700 and file 0600 with no leftover temp file", () => {
    const dir = path.join(workDir, "session-home", ".glassypic");
    const manager = new SessionManager(dir);
    manager.saveMcpToken("mcp_secret", "a@b.co", "free");
    if (process.platform !== "win32") {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(dir, "session.json")).mode & 0o777).toBe(0o600);
    }
    expect(fs.readdirSync(dir)).toEqual(["session.json"]);
    expect(manager.getMcpToken()).toBe("mcp_secret");
  });
});
