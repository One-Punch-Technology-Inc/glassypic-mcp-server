import * as fs from "node:fs";
import * as path from "node:path";

export interface ResolvedInput {
  buffer: Buffer;
  filename: string;
  isUrl: boolean;
}

/**
 * Extensions the API accepts (see the upload error in api/upload.ts, plus SVG/ICO).
 * The path comes from the model, which can be steered by untrusted content, so an
 * allowlist stops a prompt-injected call from uploading an arbitrary local file
 * (an SSH key, a .env) off the machine.
 */
const ALLOWED_INPUT_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif",
  ".heic", ".heif", ".tiff", ".tif", ".bmp", ".svg", ".ico",
]);

/** Matches the API's default max_file_size_mb; checked before reading into memory. */
const MAX_INPUT_BYTES = 50 * 1024 * 1024;

export function isUrl(input: string): boolean {
  return input.startsWith("http://") || input.startsWith("https://");
}

export function extractFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const basename = path.basename(pathname);
    if (basename && path.extname(basename)) {
      return basename;
    }
    return "image";
  } catch {
    return "image";
  }
}

export async function resolveInput(input: string): Promise<ResolvedInput> {
  const absolutePath = path.resolve(input);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const extension = path.extname(absolutePath).toLowerCase();
  if (!ALLOWED_INPUT_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported file type "${extension || "(none)"}". Supported: JPEG, PNG, WebP, AVIF, GIF, HEIC, TIFF, BMP, SVG, ICO.`,
    );
  }

  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`Not a regular file: ${absolutePath}`);
  }
  if (stats.size > MAX_INPUT_BYTES) {
    throw new Error(
      `File is ${(stats.size / (1024 * 1024)).toFixed(1)} MB; the maximum is ${MAX_INPUT_BYTES / (1024 * 1024)} MB.`,
    );
  }

  return {
    buffer: fs.readFileSync(absolutePath),
    filename: path.basename(absolutePath),
    isUrl: false,
  };
}
