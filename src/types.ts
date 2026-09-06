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
] as const;

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
  // Request body shape: Amazon (taskType/textToImageParams) or Stability
  // (prompt/aspect_ratio). Defaults to "amazon".
  format: z.enum(["amazon", "stability"]).optional(),
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
export type VideoModel = z.infer<typeof VideoModelSchema>;
export type EmbeddingModel = z.infer<typeof EmbeddingModelSchema>;
