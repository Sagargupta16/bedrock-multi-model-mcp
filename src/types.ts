import { z } from "zod";

// Schemas validate the JSON data files at load time so a malformed or
// half-edited registry fails loudly at startup instead of at call time.

// Closed set so a typo in a registry entry (e.g. "tool-use" for "tool_use")
// fails at load time instead of being printed verbatim by bedrock_list_models.
export const CAPABILITIES = [
  "text",
  "vision",
  "tool_use",
  "streaming",
  "reasoning",
  // Accepts Converse outputConfig.textFormat (JSON schema output). Measured per
  // model: Nova and Pixtral reject the field, and Magistral Small accepts it but
  // ignores the schema (2026-11-01).
  "structured_output",
] as const;

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const TextModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  useCase: z.string(),
  aliases: z.array(z.string()),
  capabilities: z.array(z.enum(CAPABILITIES)),
  // Default output cap this server sends when a caller omits max_tokens. It is
  // deliberately below the model's documented ceiling; override per call.
  maxTokens: z.number().positive(),
  noTemperature: z.boolean().optional(),
  // Accepts Converse outputConfig.effort. Measured per model: Claude Haiku 4.5 and
  // the open-weight models reject it ("This model doesn't support the effort field").
  effort: z.boolean().optional(),
  // Which Bedrock API serves the model. "mantle" models (Gemma 4) are only on the
  // OpenAI-compatible bedrock-mantle endpoint; everything else uses Converse.
  api: z.enum(["converse", "mantle"]).optional(),
});

export const ImageModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  aliases: z.array(z.string()),
  // No maxResolution field: Stability models take an aspect ratio and choose
  // the output pixels themselves, so a declared ceiling here was both unused
  // and wrong (a stable-core 16:9 request wrote 2016x1152 on 2026-09-06).
  // Region the model is served from; falls back to the default region.
  region: z.string().optional(),
});

// Request body fields the Stability image-edit services take besides the input
// image (AWS "Stability AI Image Services" page). Closed set, so a typo in
// image-edit-models.json fails at load time.
export const EDIT_FIELDS = [
  "prompt",
  "negative_prompt",
  "mask",
  "style_image",
  "search_prompt",
  "select_prompt",
  "left",
  "right",
  "up",
  "down",
  "creativity",
  "control_strength",
  "grow_mask",
  "fidelity",
  "aspect_ratio",
  "composition_fidelity",
  "style_strength",
  "change_strength",
  "style_preset",
  "seed",
] as const;
export type EditField = (typeof EDIT_FIELDS)[number];

export const ImageEditModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  // The tool-facing name, e.g. "inpaint"; unique across the registry.
  operation: z.string(),
  region: z.string(),
  // Body field that carries the input image; Style Transfer calls it init_image.
  imageField: z.enum(["image", "init_image"]).optional(),
  // Fields the operation needs besides the image, and the optional ones it takes.
  requires: z.array(z.enum(EDIT_FIELDS)),
  accepts: z.array(z.enum(EDIT_FIELDS)),
  // At least one of these must be non-zero (Outpaint's four directions).
  requiresOneOf: z.array(z.enum(EDIT_FIELDS)).optional(),
  // Result format when the caller sets none (default png). The three upscalers
  // default to webp: their PNG is over Bedrock's 16 MB response limit (22 to
  // 43 MB measured 2026-11-01, against 2.5 MB as webp).
  outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
});

export const VideoModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  aliases: z.array(z.string()),
  region: z.string().optional(),
  // Request body shape for StartAsyncInvoke.
  format: z.enum(["luma-ray"]),
});

export const EmbeddingModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  aliases: z.array(z.string()),
  dimensions: z.number().positive(),
  modality: z.string(),
});

export type TextModel = z.infer<typeof TextModelSchema>;
export type ImageModel = z.infer<typeof ImageModelSchema>;
export type ImageEditModel = z.infer<typeof ImageEditModelSchema>;
export type VideoModel = z.infer<typeof VideoModelSchema>;
export type EmbeddingModel = z.infer<typeof EmbeddingModelSchema>;
