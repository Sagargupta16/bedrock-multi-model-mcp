import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { readFileSync } from "node:fs";
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { ImageModelSchema, type ImageModel } from "../types.js";
import { bearerToken, bedrockFetch, getClient } from "./client.js";

// Image model catalog loaded and validated from src/data/image-models.json.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const raw = readFileSync(join(dataDir, "image-models.json"), "utf-8");
export const IMAGE_MODELS: ImageModel[] = z
  .array(ImageModelSchema)
  .parse(JSON.parse(raw));

// alias -> model, plus id -> model so a full model ID resolves to its entry
// (and therefore its request `format`) instead of falling through to the
// wrong Amazon request shape.
const IMAGE_ALIASES: Record<string, ImageModel> = Object.fromEntries(
  IMAGE_MODELS.flatMap((m) =>
    [...m.aliases, m.id].map((a) => [a.toLowerCase(), m]),
  ),
);

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
function readPngSize(png: Buffer): { width: number; height: number } | undefined {
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

// Nova Canvas and Titan Image Generator v2 share the Amazon image request
// shape (taskType TEXT_IMAGE + textToImageParams + imageGenerationConfig).
// Stability models (SD3.5, Core, Ultra) use prompt + aspect_ratio. Both
// return { images: [base64] }.
function buildRequestBody(
  options: ImageOptions,
  width: number,
  height: number,
  format: ImageModel["format"],
): string {
  if (format === "stability") {
    return JSON.stringify({
      prompt: options.prompt,
      ...(options.negativePrompt && { negative_prompt: options.negativePrompt }),
      aspect_ratio: toAspectRatio(width, height),
      output_format: "png",
      ...(options.seed !== undefined && { seed: options.seed }),
    });
  }
  return JSON.stringify({
    taskType: "TEXT_IMAGE",
    textToImageParams: {
      text: options.prompt,
      ...(options.negativePrompt && { negativeText: options.negativePrompt }),
    },
    imageGenerationConfig: {
      numberOfImages: 1,
      width,
      height,
      cfgScale: 8.0,
      ...(options.seed !== undefined && { seed: options.seed }),
    },
  });
}

export async function generateImage(options: ImageOptions): Promise<ImageResult> {
  const entry = getImageModel(options.model);
  const modelId = entry?.id ?? options.model;
  const modelRegion = entry?.region;
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;

  const body = buildRequestBody(options, width, height, entry?.format);
  const start = Date.now();
  let responseBody: string;

  try {
    const command = new InvokeModelCommand({
      modelId,
      body: new TextEncoder().encode(body),
      contentType: "application/json",
      accept: "application/json",
    });
    const response = await getClient(modelRegion).send(command);
    responseBody = new TextDecoder().decode(response.body);
  } catch (sdkErr) {
    if (!bearerToken) throw sdkErr;
    const json = await bedrockFetch(
      `model/${encodeURIComponent(modelId)}/invoke`,
      { method: "POST", body },
      modelRegion,
    );
    responseBody = JSON.stringify(json);
  }

  const latencyMs = Date.now() - start;

  const parsed = JSON.parse(responseBody) as {
    images?: string[];
    error?: string;
    // Stability (SD3.5/Core/Ultra) reports content-filter and inference
    // failures here; a null entry means success. There is no `error` field.
    finish_reasons?: (string | null)[];
  };
  if (parsed.error) throw new Error(parsed.error);
  const finishReason = parsed.finish_reasons?.find((r) => r != null);
  if (finishReason) throw new Error(`Image generation failed: ${finishReason}`);
  const base64 = parsed.images?.[0];
  if (!base64) throw new Error("Model returned no image data");

  const outputDir = await resolveOutputDir(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const filePath = join(outputDir, `${timestamp}.png`);
  const png = Buffer.from(base64, "base64");
  await writeFile(filePath, png);

  const size = readPngSize(png);
  return { modelId, filePath, width: size?.width, height: size?.height, latencyMs };
}
