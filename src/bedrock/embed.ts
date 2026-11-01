import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { indexByAlias, loadRegistry } from "../models.js";
import { EmbeddingModelSchema, type EmbeddingModel } from "../types.js";
import { getClient } from "./client.js";

// Embedding model catalog loaded and validated from src/data/embedding-models.json.
export const EMBEDDING_MODELS: EmbeddingModel[] = loadRegistry("embedding-models.json", EmbeddingModelSchema);

const EMBEDDING_ALIASES = indexByAlias(EMBEDDING_MODELS);

export function getEmbeddingModel(alias: string): EmbeddingModel | undefined {
  return EMBEDDING_ALIASES[alias.toLowerCase()];
}

// Titan takes one text per request; this many run at once, so a 50-text call
// is 7 rounds of requests instead of 50 in a row.
const TITAN_CONCURRENCY = 8;

async function invoke(modelId: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const command = new InvokeModelCommand({
    modelId,
    body: new TextEncoder().encode(JSON.stringify(body)),
    contentType: "application/json",
    accept: "application/json",
  });
  const response = await getClient().send(command, { abortSignal: signal });
  return JSON.parse(new TextDecoder().decode(response.body)) as unknown;
}

// Amazon Titan embeds one text per call: { inputText } -> { embedding: number[] }.
// Cohere embeds a batch: { texts, input_type }. Embed v3 answers with
// { embeddings: number[][] }; Embed v4 keys them by type even when no type is
// asked for, { embeddings: { float: number[][] } } (probed 2026-11-01).
export async function embed(modelId: string, texts: string[], signal?: AbortSignal): Promise<number[][]> {
  // Matches the base id and its inference profiles (us.cohere.embed-v4:0).
  const isCohere = /(^|\.)cohere\./.test(modelId);

  if (isCohere) {
    const res = (await invoke(modelId, { texts, input_type: "search_document" }, signal)) as {
      embeddings?: number[][] | { float?: number[][] };
    };
    const vectors = Array.isArray(res.embeddings) ? res.embeddings : res.embeddings?.float;
    if (!vectors) throw new Error("Model returned no embeddings");
    return vectors;
  }

  // Titan: one request per text, TITAN_CONCURRENCY at a time, results kept in input order.
  const vectors: number[][] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    const i = next++;
    if (i >= texts.length) return;
    const res = (await invoke(modelId, { inputText: texts[i] }, signal)) as { embedding?: number[] };
    if (!res.embedding) throw new Error("Model returned no embedding");
    vectors[i] = res.embedding;
    return worker();
  };
  await Promise.all(Array.from({ length: Math.min(TITAN_CONCURRENCY, texts.length) }, worker));
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
