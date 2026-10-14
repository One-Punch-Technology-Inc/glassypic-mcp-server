import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";

// Mock MCP SDK before importing index (vi.mock is hoisted)
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: vi.fn(),
}));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(() => ({})),
}));
vi.mock("../tools/optimize.js", () => ({
  optimizeImage: vi.fn(),
}));
vi.mock("../errors.js", () => ({
  formatErrorForMcp: vi.fn((error: unknown) => ({
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : "unexpected error",
      },
    ],
    isError: true as const,
  })),
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { optimizeImage } from "../tools/optimize.js";
import { formatErrorForMcp } from "../errors.js";
import type { OptimizeImageResult } from "../tools/optimize.js";

describe("optimize_image tool handler (index.ts)", () => {
  let handler: (params: any) => Promise<any>;

  beforeAll(async () => {
    const mockServerInstance = {
      registerTool: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(McpServer).mockImplementation(() => mockServerInstance as any);

    const { createServer } = await import("../index.js");
    createServer();

    handler = mockServerInstance.registerTool.mock.calls[0]?.[2];
  });

  afterEach(() => {
    vi.mocked(optimizeImage).mockReset();
    vi.mocked(formatErrorForMcp).mockReset();
  });

  function makeResult(overrides: Partial<OptimizeImageResult> = {}): OptimizeImageResult {
    return {
      output_path: "/Users/me/hero.polished.png",
      output_size_bytes: 30720,
      output_width_px: 800,
      output_height_px: 600,
      output_format: "png",
      compression_ratio: 0.6,
      seo_alt_text: "A scenic mountain view",
      seo_keywords: ["mountain", "scenic"],
      seo_filename: "mountain-view",
      ...overrides,
    };
  }

  it("a remote result says the link expires, so it is used promptly", async () => {
    vi.mocked(optimizeImage).mockResolvedValueOnce(
      makeResult({
        output_path: "https://storage.googleapis.com/bucket/job-1?sig=abc",
        download_expires_in_seconds: 900,
      }),
    );

    const result = await handler({ input: "https://example.com/hero.png" });

    expect(result.content[0].text).toContain(
      "Download (link expires in 15 min): https://storage.googleapis.com/bucket/job-1?sig=abc",
    );
    expect(result.content[0].text).not.toContain("Optimized: ");
    expect(result.structuredContent.download_expires_in_seconds).toBe(900);
  });

  it("summary includes path, size, compression ratio, format, dimensions, and alt text", async () => {
    vi.mocked(optimizeImage).mockResolvedValueOnce(makeResult());

    const result = await handler({ input: "/Users/me/hero.png" });

    expect(result.content[0].text).toContain("Optimized: /Users/me/hero.polished.png");
    expect(result.content[0].text).toContain("30.0 KB");
    expect(result.content[0].text).toContain("60%");
    expect(result.content[0].text).toContain("Format: png");
    expect(result.content[0].text).toContain("800x600");
    expect(result.content[0].text).toContain("A scenic mountain view");
  });

  it("omits null fields from summary (no compression, dimensions, format, or alt text)", async () => {
    vi.mocked(optimizeImage).mockResolvedValueOnce(
      makeResult({
        output_width_px: null,
        output_height_px: null,
        output_format: null,
        compression_ratio: null,
        seo_alt_text: null,
        seo_keywords: null,
        seo_filename: null,
      }),
    );

    const result = await handler({ input: "/Users/me/hero.png" });

    expect(result.content[0].text).toContain("Optimized:");
    expect(result.content[0].text).not.toContain("Compression:");
    expect(result.content[0].text).not.toContain("Format:");
    expect(result.content[0].text).not.toContain("Dimensions:");
    expect(result.content[0].text).not.toContain("Alt text:");
  });

  it("returns structuredContent with the full result object", async () => {
    const mockResult = makeResult({
      output_path: "/Users/me/hero.polished.webp",
      output_format: "webp",
    });
    vi.mocked(optimizeImage).mockResolvedValueOnce(mockResult);

    const result = await handler({ input: "/Users/me/hero.png" });

    expect(result.structuredContent).toEqual(mockResult);
  });

  it("forwards all params to optimizeImage", async () => {
    vi.mocked(optimizeImage).mockResolvedValueOnce(makeResult());

    await handler({
      input: "/Users/me/img.png",
      output_path: "/out/img.webp",
      output_format: "webp",
      output_width_px: 400,
      output_height_px: 300,
      output_upscale_factor: 2,
      output_resize_behavior: "crop",
      output_seo_tag_gen: false,
    });

    expect(vi.mocked(optimizeImage)).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "/Users/me/img.png",
        output_path: "/out/img.webp",
        output_format: "webp",
        output_width_px: 400,
        output_height_px: 300,
        output_upscale_factor: 2,
        output_resize_behavior: "crop",
        output_seo_tag_gen: false,
      }),
    );
  });

  it("returns isError result when optimizeImage throws", async () => {
    vi.mocked(optimizeImage).mockRejectedValueOnce(new Error("File not found"));
    vi.mocked(formatErrorForMcp).mockReturnValueOnce({
      content: [{ type: "text", text: "File not found" }],
      isError: true,
    });

    const result = await handler({ input: "/missing/image.png" });

    expect(result.isError).toBe(true);
    expect(vi.mocked(formatErrorForMcp)).toHaveBeenCalled();
  });

  it("omits dimensions from summary when only one dimension is present", async () => {
    vi.mocked(optimizeImage).mockResolvedValueOnce(
      makeResult({ output_width_px: 800, output_height_px: null }),
    );

    const result = await handler({ input: "/Users/me/hero.png" });

    expect(result.content[0].text).not.toContain("Dimensions:");
  });
});

describe("direct-run guard", () => {
  it("treats a package bin symlink to the module as direct", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glassypic-bin-"));
    try {
      const modulePath = path.join(tmpDir, "dist", "index.js");
      fs.mkdirSync(path.dirname(modulePath), { recursive: true });
      fs.writeFileSync(modulePath, "");

      const binDir = path.join(tmpDir, "node_modules", ".bin");
      fs.mkdirSync(binDir, { recursive: true });
      const binPath = path.join(binDir, "glassypic-mcp-server");
      fs.symlinkSync(modulePath, binPath);

      const { isDirectEntrypoint } = await import("../index.js");

      expect(isDirectEntrypoint(binPath, modulePath)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not throw when argv path cannot be realpath resolved", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "glassypic-bin-"));
    try {
      const missingPath = path.join(tmpDir, "missing", "index.js");
      const { isDirectEntrypoint } = await import("../index.js");

      expect(isDirectEntrypoint(missingPath, path.resolve(missingPath))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("tool annotations", () => {
  beforeEach(() => {
    vi.stubEnv("MCP_TRANSPORT", "");
  });

  it("declares the documented hints on all five tools", async () => {
    const registerTool = vi.fn();
    vi.mocked(McpServer).mockImplementation(() => ({
      registerTool,
      connect: vi.fn().mockResolvedValue(undefined),
    }) as any);

    const { createServer } = await import("../index.js");
    createServer();

    const annotationsFor = (name: string) =>
      registerTool.mock.calls.find((call) => call[0] === name)?.[1]?.annotations;

    expect(annotationsFor("optimize_image")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(annotationsFor("login")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(annotationsFor("logout")).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    // destructiveHint is meaningless when readOnlyHint is true, so it is omitted.
    expect(annotationsFor("status")).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(annotationsFor("upgrade")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it("still supplies a title on all five", async () => {
    const registerTool = vi.fn();
    vi.mocked(McpServer).mockImplementation(() => ({
      registerTool,
      connect: vi.fn().mockResolvedValue(undefined),
    }) as any);

    const { createServer } = await import("../index.js");
    createServer();

    for (const call of registerTool.mock.calls) {
      expect(call[1].title).toBeTruthy();
    }
  });
});
