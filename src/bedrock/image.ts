import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { randomUUID } from "node:crypto";
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { indexByAlias, loadRegistry } from "../models.js";
import { ImageModelSchema, type ImageModel } from "../types.js";
import { getClient } from "./client.js";

// Image model catalog loaded and validated from src/data/image-models.json.
export const IMAGE_MODELS: ImageModel[] = loadRegistry("image-models.json", ImageModelSchema);

// alias -> model, plus id -> model so a full model ID resolves to its entry
// (and therefore its region) too.
const IMAGE_ALIASES = indexByAlias(IMAGE_MODELS, (m) => [...m.aliases, m.id]);

export function getImageModel(alias: string): ImageModel | undefined {
  return IMAGE_ALIASES[alias.toLowerCase()];
}

export interface ImageOptions {
  model: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  outputDir?: string;
  // Aborts the request when the MCP client cancels the tool call.
  signal?: AbortSignal;
}

export interface ImageResult {
  modelId: string;
  filePath: string;
  // Measured from the saved file, not echoed from the request: Stability models
  // take an aspect ratio and pick the pixel dimensions themselves. Undefined if
  // the payload was not a parsable PNG.
  width?: number;
  height?: number;
  latencyMs: number;
}

// PNG dimensions live in the IHDR chunk: 8-byte signature, 4-byte chunk length,
// 4-byte "IHDR" type, then width and height as big-endian uint32s.
// Exported for src/models.test.ts.
export function readPngSize(png: Buffer): { width: number; height: number } | undefined {
  if (png.length < 24) return undefined;
  if (png.readUInt32BE(0) !== 0x89504e47) return undefined;
  if (png.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function isWritable(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveOutputDir(explicit?: string): Promise<string> {
  if (explicit) {
    return isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit);
  }
  const fromEnv = process.env.BEDROCK_MCP_OUTPUT_DIR;
  if (fromEnv) return fromEnv;

  const cwd = process.cwd();
  const lower = cwd.toLowerCase();
  const isSystemDir =
    lower.includes(String.raw`\windows\system32`) ||
    lower.includes(String.raw`\windows\syswow64`) ||
    lower === String.raw`c:\windows` ||
    lower === "/";

  if (!isSystemDir && (await isWritable(cwd))) {
    return cwd;
  }
  return join(homedir(), "bedrock-images");
}

// Stability models take an aspect ratio instead of explicit dimensions.
function toAspectRatio(width: number, height: number): string {
  const supported: [string, number][] = [
    ["1:1", 1],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
    ["4:5", 4 / 5],
    ["5:4", 5 / 4],
    ["21:9", 21 / 9],
    ["9:21", 9 / 21],
  ];
  const target = width / height;
  let best = supported[0];
  for (const entry of supported) {
    if (Math.abs(entry[1] - target) < Math.abs(best[1] - target)) best = entry;
  }
  return best[0];
}

// Every text-to-image model on Bedrock is Stability's now (Nova Canvas reached
// end-of-life on 2026-09-30, Titan Image before it), and they share one request
// shape: prompt + aspect_ratio in, { images: [base64] } out. An id outside the
// registry gets the same shape.
function buildRequestBody(options: ImageOptions, width: number, height: number): string {
  return JSON.stringify({
    prompt: options.prompt,
    ...(options.negativePrompt && { negative_prompt: options.negativePrompt }),
    aspect_ratio: toAspectRatio(width, height),
    output_format: "png",
    ...(options.seed !== undefined && { seed: options.seed }),
  });
}

export async function generateImage(options: ImageOptions): Promise<ImageResult> {
  const entry = getImageModel(options.model);
  const modelId = entry?.id ?? options.model;
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;

  const start = Date.now();
  const command = new InvokeModelCommand({
    modelId,
    body: new TextEncoder().encode(buildRequestBody(options, width, height)),
    contentType: "application/json",
    accept: "application/json",
  });
  const response = await getClient(entry?.region).send(command, { abortSignal: options.signal });
  const latencyMs = Date.now() - start;

  const saved = await saveImage(firstImage(response.body), options.outputDir);
  return { modelId, ...saved, latencyMs };
}

// The first image of a Stability response ({ images, finish_reasons }), shared
// by text-to-image and the image-edit services, which answer the same way.
export function firstImage(responseBody: Uint8Array): string {
  const parsed = JSON.parse(new TextDecoder().decode(responseBody)) as {
    images?: string[];
    error?: string;
    // Stability reports content-filter and inference failures here; a null
    // entry means success. There is no `error` field.
    finish_reasons?: (string | null)[];
  };
  if (parsed.error) throw new Error(parsed.error);
  const finishReason = parsed.finish_reasons?.find((r) => r != null);
  if (finishReason) throw new Error(`Image generation failed: ${finishReason}`);
  const base64 = parsed.images?.[0];
  if (!base64) throw new Error("Model returned no image data");
  return base64;
}

// Saves a base64 image to the resolved output directory. The size is read back
// for a PNG and left undefined for the other formats.
export async function saveImage(
  base64: string,
  outputDirOption?: string,
  format: "png" | "jpeg" | "webp" = "png",
): Promise<{ filePath: string; width?: number; height?: number }> {
  const outputDir = await resolveOutputDir(outputDirOption);
  await mkdir(outputDir, { recursive: true });
  // The suffix keeps two images finished in the same millisecond from
  // overwriting each other.
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const ext = format === "jpeg" ? "jpg" : format;
  const filePath = join(outputDir, `${timestamp}-${randomUUID().slice(0, 8)}.${ext}`);
  const bytes = Buffer.from(base64, "base64");
  await writeFile(filePath, bytes);

  const size = format === "png" ? readPngSize(bytes) : undefined;
  return { filePath, width: size?.width, height: size?.height };
}
