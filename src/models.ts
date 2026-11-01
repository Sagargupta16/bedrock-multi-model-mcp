import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import { TextModelSchema, type TextModel } from "./types.js";

// Model data lives in src/data/*.json (copied to dist/data on build) so the
// catalog can be edited without touching code. Validated here at load time.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "data");

// Loads one registry file and validates every entry, so a malformed catalog
// fails at startup. Shared by the text, image, video and embedding registries.
export function loadRegistry<T>(file: string, entry: z.ZodType<T>): T[] {
  const raw = readFileSync(join(dataDir, file), "utf-8");
  return z.array(entry).parse(JSON.parse(raw));
}

// Lower-cased lookup key -> entry. Keys default to the entry's aliases.
export function indexByAlias<T extends { aliases: string[] }>(
  models: T[],
  keys: (m: T) => string[] = (m) => m.aliases,
): Record<string, T> {
  return Object.fromEntries(models.flatMap((m) => keys(m).map((k) => [k.toLowerCase(), m])));
}

export const TEXT_MODELS: TextModel[] = loadRegistry("text-models.json", TextModelSchema);

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
