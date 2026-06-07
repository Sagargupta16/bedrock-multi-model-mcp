import { z } from "zod";

// Schemas validate the JSON data files at load time so a malformed or
// half-edited registry fails loudly at startup instead of at call time.

export const TextModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  useCase: z.string(),
  aliases: z.array(z.string()),
  capabilities: z.array(z.string()),
  maxTokens: z.number().positive(),
  noTemperature: z.boolean().optional(),
});

export const ImageModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  aliases: z.array(z.string()),
  maxResolution: z.string(),
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
export type EmbeddingModel = z.infer<typeof EmbeddingModelSchema>;
