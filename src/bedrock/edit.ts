import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { loadRegistry } from "../models.js";
import { ImageEditModelSchema, type EditField, type ImageEditModel } from "../types.js";
import { getClient } from "./client.js";
import { firstImage, saveImage } from "./image.js";

// Stability AI Image Services: thirteen InvokeModel endpoints that take an input
// image (inpaint, outpaint, erase, upscale, control, style). Catalog loaded and
// validated from src/data/image-edit-models.json.
export const EDIT_MODELS: ImageEditModel[] = loadRegistry("image-edit-models.json", ImageEditModelSchema);

const BY_OPERATION = new Map(EDIT_MODELS.map((m) => [m.operation, m]));

export function getEditModel(operation: string): ImageEditModel | undefined {
  return BY_OPERATION.get(operation);
}

export const STYLE_PRESETS = [
  "3d-model", "analog-film", "anime", "cinematic", "comic-book", "digital-art", "enhance",
  "fantasy-art", "isometric", "line-art", "low-poly", "modeling-compound", "neon-punk",
  "origami", "photographic", "pixel-art", "tile-texture",
] as const;

export const EDIT_ASPECT_RATIOS = ["16:9", "1:1", "21:9", "2:3", "3:2", "4:5", "5:4", "9:16", "9:21"] as const;

export const OUTPUT_FORMATS = ["png", "jpeg", "webp"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

// Body fields that the tool takes as file paths rather than values.
const PATH_PARAM: Partial<Record<EditField, string>> = { mask: "mask_path", style_image: "style_image_path" };
const paramName = (field: EditField) => PATH_PARAM[field] ?? field;

export interface EditOptions {
  operation: string;
  imagePath: string;
  maskPath?: string;
  styleImagePath?: string;
  // Every other request field, keyed by its body name (prompt, search_prompt, seed, ...).
  fields: Partial<Record<EditField, string | number>>;
  // Defaults to the registry's outputFormat for the operation, else png.
  outputFormat?: OutputFormat;
  outputDir?: string;
  // Aborts the request when the MCP client cancels the tool call.
  signal?: AbortSignal;
}

export interface EditResult {
  modelId: string;
  modelName: string;
  filePath: string;
  width?: number;
  height?: number;
  latencyMs: number;
}

// Checks the fields against what the operation takes and builds the request
// body, so a missing or unsupported field fails before a billed call. `images`
// holds the already-encoded input image (and mask or style image when given).
export function buildEditBody(
  model: ImageEditModel,
  fields: EditOptions["fields"],
  images: { image: string; mask?: string; style_image?: string },
  outputFormat: OutputFormat,
): Record<string, unknown> {
  const given: Partial<Record<EditField, string | number>> = { ...fields };
  if (images.mask) given.mask = images.mask;
  if (images.style_image) given.style_image = images.style_image;
  const keys = (Object.keys(given) as EditField[]).filter((k) => given[k] !== undefined);

  const allowed = new Set<EditField>([...model.requires, ...model.accepts]);
  const unknown = keys.filter((k) => !allowed.has(k));
  if (unknown.length > 0) {
    const takes = [...allowed].map(paramName).join(", ") || "nothing beyond image_path";
    throw new Error(`${model.name} does not take ${unknown.map(paramName).join(", ")}. It takes: ${takes}.`);
  }
  const missing = model.requires.filter((k) => !keys.includes(k));
  if (missing.length > 0) {
    throw new Error(`${model.operation} needs ${missing.map(paramName).join(", ")}.`);
  }
  if (model.requiresOneOf && !model.requiresOneOf.some((k) => Number(given[k] ?? 0) > 0)) {
    throw new Error(`${model.operation} needs at least one of ${model.requiresOneOf.join(", ")} above 0.`);
  }

  const body: Record<string, unknown> = { [model.imageField ?? "image"]: images.image };
  for (const k of keys) body[k] = given[k];
  // Always sent: Fast Upscale lists output_format as required.
  body.output_format = outputFormat;
  return body;
}

// Reads an input image and returns it base64-encoded. Only PNG, JPEG and WebP
// (the formats the services take) are sent, so a mistyped path never ships some
// other local file to Bedrock.
async function readImage(path: string): Promise<string> {
  const full = isAbsolute(path) ? path : resolve(process.cwd(), path);
  const bytes = await readFile(full);
  const isPng = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const isJpeg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const isWebp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!isPng && !isJpeg && !isWebp) throw new Error(`${full} is not a PNG, JPEG or WebP image`);
  return bytes.toString("base64");
}

export async function editImage(options: EditOptions): Promise<EditResult> {
  const model = getEditModel(options.operation);
  if (!model) {
    const known = EDIT_MODELS.map((m) => m.operation).join(", ");
    throw new Error(`Unknown edit operation "${options.operation}". Available: ${known}`);
  }

  const format = options.outputFormat ?? model.outputFormat ?? "png";
  const body = buildEditBody(
    model,
    options.fields,
    {
      image: await readImage(options.imagePath),
      mask: options.maskPath && (await readImage(options.maskPath)),
      style_image: options.styleImagePath && (await readImage(options.styleImagePath)),
    },
    format,
  );

  const start = Date.now();
  const command = new InvokeModelCommand({
    modelId: model.id,
    body: new TextEncoder().encode(JSON.stringify(body)),
    contentType: "application/json",
    accept: "application/json",
  });
  const response = await getClient(model.region).send(command, { abortSignal: options.signal });
  const latencyMs = Date.now() - start;

  const saved = await saveImage(firstImage(response.body), options.outputDir, format);
  return { modelId: model.id, modelName: model.name, ...saved, latencyMs };
}
