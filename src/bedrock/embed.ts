import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import { EmbeddingModelSchema, type EmbeddingModel } from "../types.js";
import { bearerToken, bedrockFetch, getClient } from "./client.js";

// Embedding model catalog loaded and validated from src/data/embedding-models.json.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const raw = readFileSync(join(dataDir, "embedding-models.json"), "utf-8");
export const EMBEDDING_MODELS: EmbeddingModel[] = z
  .array(EmbeddingModelSchema)
  .parse(JSON.parse(raw));

const EMBEDDING_ALIASES: Record<string, EmbeddingModel> = Object.fromEntries(
  EMBEDDING_MODELS.flatMap((m) => m.aliases.map((a) => [a.toLowerCase(), m])),
);

export function getEmbeddingModel(alias: string): EmbeddingModel | undefined {
  return EMBEDDING_ALIASES[alias.toLowerCase()];
}

async function invoke(modelId: string, body: Record<string, unknown>): Promise<unknown> {
  const json = JSON.stringify(body);
  try {
    const command = new InvokeModelCommand({
      modelId,
      body: new TextEncoder().encode(json),
      contentType: "application/json",
      accept: "application/json",
    });
    const response = await getClient().send(command);
    return JSON.parse(new TextDecoder().decode(response.body));
  } catch (sdkErr) {
    if (!bearerToken) throw sdkErr;
    return bedrockFetch(`model/${encodeURIComponent(modelId)}/invoke`, {
      method: "POST",
      body: json,
    });
  }
}

// Amazon Titan embeds one text per call: { inputText } -> { embedding: number[] }.
// Cohere embeds a batch: { texts, input_type } -> { embeddings: number[][] }.
export async function embed(modelId: string, texts: string[]): Promise<number[][]> {
  const isCohere = modelId.startsWith("cohere.");

  if (isCohere) {
    const res = (await invoke(modelId, {
      texts,
      input_type: "search_document",
    })) as { embeddings?: number[][] };
    if (!res.embeddings) throw new Error("Model returned no embeddings");
    return res.embeddings;
  }

  // Titan: one request per input text.
  const vectors: number[][] = [];
  for (const text of texts) {
    const res = (await invoke(modelId, { inputText: text })) as { embedding?: number[] };
    if (!res.embedding) throw new Error("Model returned no embedding");
    vectors.push(res.embedding);
  }
  return vectors;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
