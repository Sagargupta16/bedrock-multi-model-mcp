import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import { TextModelSchema, type TextModel } from "./types.js";

// Model data lives in src/data/*.json (copied to dist/data on build) so the
// catalog can be edited without touching code. Validated here at load time.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "data");

function loadJson<T>(file: string, schema: z.ZodType<T[]>): T[] {
  const raw = readFileSync(join(dataDir, file), "utf-8");
  return schema.parse(JSON.parse(raw));
}

export const TEXT_MODELS: TextModel[] = loadJson(
  "text-models.json",
  z.array(TextModelSchema),
);

// id -> model
export const MODEL_REGISTRY: Record<string, TextModel> = Object.fromEntries(
  TEXT_MODELS.map((m) => [m.id, m]),
);

// alias -> id (aliases declared inline on each model, so they cannot drift
// to a model id that no longer exists)
export const MODEL_ALIASES: Record<string, string> = Object.fromEntries(
  TEXT_MODELS.flatMap((m) => m.aliases.map((a) => [a.toLowerCase(), m.id])),
);

export function resolveModelId(input: string): string {
  const lower = input.toLowerCase();
  // Aliases take priority; otherwise assume a full model id was passed.
  return MODEL_ALIASES[lower] ?? input;
}

export function getModelInfo(modelId: string): TextModel | undefined {
  return MODEL_REGISTRY[modelId];
}
