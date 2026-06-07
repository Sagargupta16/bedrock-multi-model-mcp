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

// alias -> model
const IMAGE_ALIASES: Record<string, ImageModel> = Object.fromEntries(
  IMAGE_MODELS.flatMap((m) => m.aliases.map((a) => [a.toLowerCase(), m])),
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
  width: number;
  height: number;
  latencyMs: number;
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

// Nova Canvas and Titan Image Generator v2 share the Amazon image request
// shape (taskType TEXT_IMAGE + textToImageParams + imageGenerationConfig) and
// both return { images: [base64Png] }.
function buildRequestBody(options: ImageOptions, width: number, height: number): string {
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
  const width = options.width ?? 1024;
  const height = options.height ?? 1024;

  const body = buildRequestBody(options, width, height);
  const start = Date.now();
  let responseBody: string;

  try {
    const command = new InvokeModelCommand({
      modelId,
      body: new TextEncoder().encode(body),
      contentType: "application/json",
      accept: "application/json",
    });
    const response = await getClient().send(command);
    responseBody = new TextDecoder().decode(response.body);
  } catch (sdkErr) {
    if (!bearerToken) throw sdkErr;
    const json = await bedrockFetch(`model/${encodeURIComponent(modelId)}/invoke`, {
      method: "POST",
      body,
    });
    responseBody = JSON.stringify(json);
  }

  const latencyMs = Date.now() - start;

  const parsed = JSON.parse(responseBody) as { images?: string[]; error?: string };
  if (parsed.error) throw new Error(parsed.error);
  const base64 = parsed.images?.[0];
  if (!base64) throw new Error("Model returned no image data");

  const outputDir = await resolveOutputDir(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const filePath = join(outputDir, `${timestamp}.png`);
  await writeFile(filePath, Buffer.from(base64, "base64"));

  return { modelId, filePath, width, height, latencyMs };
}
