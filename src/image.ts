import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;

let sdkClient: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  sdkClient ??= new BedrockRuntimeClient({ region });
  return sdkClient;
}

// All entries are ACTIVE per Bedrock's modelLifecycle.status as of 2026-05-21.
// Nova Canvas / Titan Image Gen v2 were removed (LEGACY status, EOL pending).
// Stability AI's edit/upscale suite is the current ACTIVE Bedrock image generation surface.
export const IMAGE_MODELS: Record<string, { id: string; name: string; provider: string }> = {
  "stable-inpaint": { id: "stability.stable-image-inpaint-v1:0", name: "Stable Image Inpaint", provider: "Stability AI" },
  "stable-erase": { id: "stability.stable-image-erase-object-v1:0", name: "Stable Image Erase Object", provider: "Stability AI" },
  "stable-remove-bg": { id: "stability.stable-image-remove-background-v1:0", name: "Stable Image Remove Background", provider: "Stability AI" },
  "stable-search-replace": { id: "stability.stable-image-search-replace-v1:0", name: "Stable Image Search & Replace", provider: "Stability AI" },
  "stable-search-recolor": { id: "stability.stable-image-search-recolor-v1:0", name: "Stable Image Search & Recolor", provider: "Stability AI" },
  "stable-style-guide": { id: "stability.stable-image-style-guide-v1:0", name: "Stable Image Style Guide", provider: "Stability AI" },
  "stable-style-transfer": { id: "stability.stable-style-transfer-v1:0", name: "Stable Style Transfer", provider: "Stability AI" },
  "stable-control-sketch": { id: "stability.stable-image-control-sketch-v1:0", name: "Stable Control Sketch", provider: "Stability AI" },
  "stable-control-structure": { id: "stability.stable-image-control-structure-v1:0", name: "Stable Control Structure", provider: "Stability AI" },
  "stable-outpaint": { id: "stability.stable-outpaint-v1:0", name: "Stable Outpaint", provider: "Stability AI" },
  "upscale-fast": { id: "stability.stable-fast-upscale-v1:0", name: "Stable Fast Upscale", provider: "Stability AI" },
  "upscale-conservative": { id: "stability.stable-conservative-upscale-v1:0", name: "Stable Conservative Upscale", provider: "Stability AI" },
  "upscale-creative": { id: "stability.stable-creative-upscale-v1:0", name: "Stable Creative Upscale", provider: "Stability AI" },
};

export type ImageModelAlias = keyof typeof IMAGE_MODELS;

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

const NOVA_STYLES = [
  "PHOTOREALISM", "3D_ANIMATED_FAMILY_FILM", "DESIGN_SKETCH",
  "FLAT_VECTOR_ILLUSTRATION", "GRAPHIC_NOVEL_ILLUSTRATION",
  "MAXIMALISM", "MIDCENTURY_RETRO", "SOFT_DIGITAL_PAINTING",
] as const;

export type NovaStyle = typeof NOVA_STYLES[number];

export interface ImageOptions {
  model: string;
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  style?: string;
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

function buildRequestBody(_modelId: string, options: ImageOptions): string {
  // Stability suite uses a unified body shape for text-prompted edits / upscales.
  // Edit modes (inpaint/erase/search-replace/etc) typically expect an `image` parameter
  // as well; callers must pass it via options.style or extend ImageOptions if needed.
  return JSON.stringify({
    prompt: options.prompt,
    output_format: "png",
    ...(options.negativePrompt && { negative_prompt: options.negativePrompt }),
    seed: options.seed ?? 0,
  });
}

function extractBase64(_modelId: string, responseBody: string): string {
  const json = JSON.parse(responseBody);
  // Stability suite returns base64 in images[0].
  return json.images[0];
}

async function invokeViaHttp(modelId: string, body: string): Promise<string> {
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bedrock API error (${response.status}): ${text}`);
  }
  return await response.text();
}

export async function generateImage(options: ImageOptions): Promise<ImageResult> {
  // Resolve alias
  const entry = IMAGE_MODELS[options.model.toLowerCase()];
  const modelId = entry?.id ?? options.model;
  const w = options.width ?? 1024;
  const h = options.height ?? 1024;

  const body = buildRequestBody(modelId, options);
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
    responseBody = await invokeViaHttp(modelId, body);
  }

  const latencyMs = Date.now() - start;
  const base64 = extractBase64(modelId, responseBody);

  const outputDir = await resolveOutputDir(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const filename = `${timestamp}.png`;
  const filePath = join(outputDir, filename);
  await writeFile(filePath, Buffer.from(base64, "base64"));

  return { modelId, filePath, width: w, height: h, latencyMs };
}
