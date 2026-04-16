import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;

let sdkClient: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  sdkClient ??= new BedrockRuntimeClient({ region });
  return sdkClient;
}

export const IMAGE_MODELS: Record<string, { id: string; name: string; provider: string }> = {
  "nova-canvas": { id: "amazon.nova-canvas-v1:0", name: "Nova Canvas", provider: "Amazon" },
  "titan-image": { id: "amazon.titan-image-generator-v2:0", name: "Titan Image Gen v2", provider: "Amazon" },
  "sd3.5-large": { id: "stability.sd3-5-large-v1:0", name: "SD 3.5 Large", provider: "Stability AI" },
  "sdxl": { id: "stability.stable-diffusion-xl-v1:0", name: "SDXL 1.0", provider: "Stability AI" },
};

export type ImageModelAlias = keyof typeof IMAGE_MODELS;

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
}

export interface ImageResult {
  modelId: string;
  filePath: string;
  width: number;
  height: number;
  latencyMs: number;
}

function buildRequestBody(modelId: string, options: ImageOptions): string {
  const w = options.width ?? 1024;
  const h = options.height ?? 1024;

  if (modelId.startsWith("amazon.nova-canvas")) {
    return JSON.stringify({
      taskType: "TEXT_IMAGE",
      textToImageParams: {
        text: options.prompt,
        ...(options.negativePrompt && { negativeText: options.negativePrompt }),
        ...(options.style && { style: options.style }),
      },
      imageGenerationConfig: {
        width: w,
        height: h,
        quality: "standard",
        cfgScale: 6.5,
        seed: options.seed ?? Math.floor(Math.random() * 2147483646),
        numberOfImages: 1,
      },
    });
  }

  if (modelId.startsWith("amazon.titan-image")) {
    return JSON.stringify({
      taskType: "TEXT_IMAGE",
      textToImageParams: {
        text: options.prompt,
        ...(options.negativePrompt && { negativeText: options.negativePrompt }),
      },
      imageGenerationConfig: {
        width: w,
        height: h,
        quality: "standard",
        cfgScale: 8.0,
        seed: options.seed ?? Math.floor(Math.random() * 2147483646),
        numberOfImages: 1,
      },
    });
  }

  if (modelId.startsWith("stability.sd3")) {
    return JSON.stringify({
      prompt: options.prompt,
      mode: "text-to-image",
      output_format: "png",
      ...(options.negativePrompt && { negative_prompt: options.negativePrompt }),
      seed: options.seed ?? 0,
    });
  }

  // SDXL
  return JSON.stringify({
    text_prompts: [{ text: options.prompt, weight: 1.0 }],
    cfg_scale: 7.5,
    steps: 50,
    seed: options.seed ?? 0,
    width: w,
    height: h,
    ...(options.style && { style_preset: options.style }),
  });
}

function extractBase64(modelId: string, responseBody: string): string {
  const json = JSON.parse(responseBody);

  if (modelId.startsWith("stability.stable-diffusion-xl")) {
    return json.artifacts[0].base64;
  }
  // Nova Canvas, Titan Image, SD 3.5 all use images[0]
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

  // Save to current working directory
  const outputDir = process.cwd();
  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const filename = `${timestamp}.png`;
  const filePath = join(outputDir, filename);
  await writeFile(filePath, Buffer.from(base64, "base64"));

  return { modelId, filePath, width: w, height: h, latencyMs };
}
