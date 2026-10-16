#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { formatErrorForMcp } from "./errors.js";
import { optimizeImage } from "./tools/optimize.js";
import { loginTool } from "./tools/login.js";
import { logoutTool } from "./tools/logout.js";
import { statusTool } from "./tools/status.js";
import { upgradeTool } from "./tools/upgrade.js";
import { costSummary, UPSCALE_COST_NOTE, RESIZE_COST_NOTE, SEO_COST_NOTE } from "./costs.js";

export { optimizeBuffer } from "./tools/optimizeBuffer.js";
export type { OptimizeBufferParams, OptimizeBufferResult } from "./tools/optimizeBuffer.js";

function comparablePath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  try {
    return fs.realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export function isDirectEntrypoint(argvPath: string | undefined, modulePath: string): boolean {
  if (argvPath === undefined) return false;
  return comparablePath(argvPath) === comparablePath(modulePath);
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "glassypic",
    version: "2.1.2",
  });

server.registerTool(
  "optimize_image",
  {
    title: "Optimize Image",
    description:
      "Optimize an image: smart lossy compression (typically 60-80% size reduction), optional resize/upscale/format conversion, and AI-generated SEO metadata. " +
      "Accepts absolute local file paths or remote URLs. In remote/API mode, only remote URLs are supported. Supported input formats: JPG, PNG, WebP, AVIF, GIF, SVG, ICO, HEIC, TIFF, BMP (max 50 MB). Supported output formats: JPG, PNG, WebP, AVIF, GIF, SVG, ICO. " +
      costSummary() + " " +
      "Works as a guest with no signup. Log in with the login tool for more credits. Use status tool to check remaining credits before batch processing.",
    inputSchema: {
      input: z
        .string()
        .describe(
          "Absolute local file path or remote URL of the image to optimize. Note: in remote/API mode, only remote URLs are supported (no local file paths). Supported inputs: JPG, PNG, WebP, AVIF, GIF (animated supported), HEIC, TIFF, BMP (max 50 MB). GlassyPic supports high-quality conversion between any input and output format.",
        ),
      output_path: z
        .string()
        .optional()
        .describe(
          "Where to save. Accepts a file path (/tmp/out.webp) or directory ending in / (/tmp/images/). " +
          "If omitted: saves next to original, named with SEO slug when SEO is enabled or .polished suffix otherwise. URLs save to current working directory.",
        ),
      output_format: z
        .enum(["original", "jpg", "png", "webp", "avif", "gif", "svg", "ico"])
        .optional()
        .describe("Output format. Defaults to 'original' (keep input format). Animated GIFs stay animated when output is 'gif'; converting to other formats preserves only the first frame. SVG output from raster input uses vector tracing. ICO output generates a favicon set (16, 24, 32, 48, 256px) unless a specific size is given."),
      output_width_px: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Target width in pixels. Set only width for proportional resize. Set both width and height for exact output dimensions (see output_resize_behavior). " +
          RESIZE_COST_NOTE,
        ),
      output_height_px: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Target height in pixels. Set only height for proportional resize. Set both width and height for exact output dimensions (see output_resize_behavior). " +
          RESIZE_COST_NOTE,
        ),
      output_upscale_factor: z
        .union([z.literal(2), z.literal(4)])
        .optional()
        .describe(
          "AI upscale factor: 2 (2×) or 4 (4×). Uses Real-ESRGAN for high-quality upscaling. " +
          UPSCALE_COST_NOTE,
        ),
      output_resize_behavior: z
        .enum(["pad", "crop"])
        .optional()
        .describe(
          "When both width and height are set and aspect ratio differs: " +
          "'pad' adds white padding (default), 'crop' smart-crops to fill exact dimensions",
        ),
      output_seo_tag_gen: z
        .boolean()
        .optional()
        .describe(
          "Generate SEO metadata (alt text, keywords, filename) and rename output file to SEO slug. " +
          SEO_COST_NOTE,
        ),
      output_file_size_limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Target maximum output file size in bytes. The server will attempt to meet this limit through additional compression. Not guaranteed."),
      confirm_gif_cost: z
        .boolean()
        .optional()
        .describe(
          "Set to true to proceed with animated GIF processing after seeing cost warning. Required for animated GIFs to prevent unexpected credit consumption.",
        ),
      gif_frame_limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Maximum frames to process for animated GIFs (1-100, default 100). Reduces cost by sampling fewer frames while preserving animation."),
      _gif_temp_file_id: z
        .string()
        .optional()
        .describe("Internal: temp file ID from a previous GIF cost warning. Skips re-upload."),
    },
    // Keep nullable primitive branches portable: zod-to-json-schema otherwise emits
    // type arrays that some MCP clients reject. These constraints are wire-neutral.
    outputSchema: {
      output_path: z
        .string()
        .describe(
          "Local server: absolute path where the optimized file was saved. " +
          "Remote server: an https download URL that works without credentials until it expires " +
          "(see download_expires_in_seconds); download it promptly.",
        ),
      download_expires_in_seconds: z
        .union([z.number().finite(), z.null()])
        .optional()
        .describe("Remote server only: seconds until the output_path download URL expires"),
      output_size_bytes: z.number().describe("File size of the optimized image in bytes"),
      output_width_px: z.union([z.number().finite(), z.null()]).describe("Width of the output image in pixels"),
      output_height_px: z.union([z.number().finite(), z.null()]).describe("Height of the output image in pixels"),
      output_format: z.union([z.string().min(0), z.null()]).describe("Output format: jpg, png, webp, avif, gif, svg, or ico"),
      compression_ratio: z.union([z.number().finite(), z.null()]).describe("Output-to-input size ratio, e.g. 0.35 means 65% smaller"),
      seo_alt_text: z.union([z.string().min(0), z.null()]).describe("AI-generated image alt text for accessibility and SEO"),
      seo_keywords: z.union([z.array(z.string()), z.null()]).describe("AI-generated keywords describing the image"),
      seo_filename: z.union([z.string().min(0), z.null()]).describe("AI-generated SEO filename slug without extension"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async (params) => {
    try {
      const result = await optimizeImage({
        input: params.input,
        output_path: params.output_path,
        output_format: params.output_format as any,
        output_width_px: params.output_width_px,
        output_height_px: params.output_height_px,
        output_upscale_factor: params.output_upscale_factor,
        output_resize_behavior: params.output_resize_behavior as any,
        output_seo_tag_gen: params.output_seo_tag_gen,
        output_file_size_limit: params.output_file_size_limit,
        confirm_gif_cost: params.confirm_gif_cost,
        gif_frame_limit: params.gif_frame_limit,
        _gif_temp_file_id: params._gif_temp_file_id,
      });

      // Handle GIF cost warning (not a real result)
      if (result._gif_warning) {
        return { content: [{ type: "text" as const, text: result._gif_warning as string }] };
      }

      // Remote results are a time-limited link, not a saved file: say so, so the link is used promptly.
      const expiresInSeconds = result.download_expires_in_seconds;
      const locationLine =
        typeof expiresInSeconds === "number"
          ? `Optimized. Download (link expires in ${Math.max(1, Math.round(expiresInSeconds / 60))} min): ${result.output_path}`
          : `Optimized: ${result.output_path}`;

      const summary = [
        locationLine,
        `Size: ${(result.output_size_bytes / 1024).toFixed(1)} KB`,
        result.compression_ratio !== null
          ? `Compression: ${(result.compression_ratio * 100).toFixed(0)}%`
          : null,
        result.output_format ? `Format: ${result.output_format}` : null,
        result.output_width_px && result.output_height_px
          ? `Dimensions: ${result.output_width_px}x${result.output_height_px}`
          : null,
        result.seo_alt_text ? `Alt text: ${result.seo_alt_text}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: summary }],
        structuredContent: result,
      };
    } catch (error) {
      return formatErrorForMcp(error);
    }
  },
);

  if (process.env.MCP_TRANSPORT !== "http") {
    server.registerTool(
      "login",
      {
        title: "Log In",
        description:
          "Log in to your GlassyPic account via browser to unlock more credits. " +
          "Opens a browser window where you complete login (Google, Facebook, or email). " +
          "After login, MCP automatically picks up your account with shared credits across web and MCP. " +
          "Registered accounts receive a larger credit allowance than guest sessions; use the status tool to read the account's actual tier and remaining credits. " +
          "Your access token and email are stored locally at ~/.glassypic/session.json " +
          "(file mode 0600) until you run logout.",
        inputSchema: {},
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async () => {
        try {
          const message = await loginTool();
          return { content: [{ type: "text" as const, text: message }] };
        } catch (error) {
          return formatErrorForMcp(error);
        }
      },
    );

    server.registerTool(
      "logout",
      {
        title: "Log Out",
        description:
          "Log out of your GlassyPic account. Reverts to guest session. " +
          "Your web app account is not affected.",
        inputSchema: {},
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async () => {
        try {
          const message = await logoutTool();
          return { content: [{ type: "text" as const, text: message }] };
        } catch (error) {
          return formatErrorForMcp(error);
        }
      },
    );
  }

  server.registerTool(
    "status",
    {
      title: "Account Status",
      description:
        "Check your GlassyPic account status: login state, tier, credits remaining, and credit reset time. " +
        "Use this before batch processing to verify sufficient credits.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const message = await statusTool();
        return { content: [{ type: "text" as const, text: message }] };
      } catch (error) {
        return formatErrorForMcp(error);
      }
    },
  );

  server.registerTool(
    "upgrade",
    {
      title: "Open Pricing Page",
      description:
        "Open the GlassyPic pricing page in the user's browser, where the account's plan can be reviewed and changed. " +
        "Call this only when the user asks to change or review their plan.",
      inputSchema: {},
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const message = await upgradeTool();
        return { content: [{ type: "text" as const, text: message }] };
      } catch (error) {
        return formatErrorForMcp(error);
      }
    },
  );

  return server;
}

const isDirectRun = isDirectEntrypoint(process.argv[1], fileURLToPath(import.meta.url));

if (isDirectRun) {
  if (process.env.MCP_TRANSPORT === "http") {
    const { startHttpServer } = await import("./transport/http.js");
    await startHttpServer(createServer);
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
