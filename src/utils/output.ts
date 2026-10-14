import * as fs from "node:fs";
import * as path from "node:path";

interface OutputPathParams {
  inputPath: string;
  isUrl: boolean;
  filename: string;
  outputPath: string | undefined;
  outputFormat: string | undefined;
  seoFilename?: string;
  cwd?: string;
}

/** Reduces a name to `[A-Za-z0-9._-]` with no leading/trailing dots or dashes; "" if nothing is left. */
export function sanitizeFilenameStem(name: string): string {
  return name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "");
}

function getPolishedFilename(
  filename: string,
  outputFormat: string | undefined,
  seoFilename?: string,
): string {
  const ext = path.extname(filename);

  let newExt: string;
  if (!outputFormat || outputFormat === "original") {
    newExt = ext || ".png";
  } else {
    newExt = `.${outputFormat}`;
  }

  // The SEO name is server-generated from image content. The API already slugs it, but
  // it becomes part of a local path here, so never trust it to be separator-free.
  const safeSeoName = seoFilename ? sanitizeFilenameStem(seoFilename) : "";
  if (safeSeoName) {
    return `${safeSeoName}${newExt}`;
  }

  const name = path.basename(filename, ext);
  return `${name}.polished${newExt}`;
}

function isDirectoryPath(p: string): boolean {
  return p.endsWith("/") || p.endsWith(path.sep);
}

export function resolveOutputPath(params: OutputPathParams): string {
  const { inputPath, isUrl, filename, outputPath, outputFormat, seoFilename, cwd } = params;

  if (outputPath && !isDirectoryPath(outputPath)) {
    return path.resolve(outputPath);
  }

  const polishedName = getPolishedFilename(filename, outputFormat, seoFilename);

  if (outputPath && isDirectoryPath(outputPath)) {
    return path.join(path.resolve(outputPath), polishedName);
  }

  if (isUrl) {
    const baseDir = cwd ?? process.cwd();
    return path.join(baseDir, polishedName);
  }

  const inputDir = path.dirname(path.resolve(inputPath));
  return path.join(inputDir, polishedName);
}

export function resolveUniqueOutputPath(params: OutputPathParams): string {
  let outputPath = resolveOutputPath(params);
  if (!fs.existsSync(outputPath)) return outputPath;

  const ext = path.extname(outputPath);
  const base = outputPath.slice(0, -ext.length || undefined);
  let counter = 2;
  while (fs.existsSync(`${base}-${counter}${ext}`)) {
    counter++;
  }
  return `${base}-${counter}${ext}`;
}
