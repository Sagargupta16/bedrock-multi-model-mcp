import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { indexByAlias, loadRegistry } from "../models.js";
import { EmbeddingModelSchema, type EmbeddingModel } from "../types.js";
import { getClient } from "./client.js";
import { readImageFile } from "./edit.js";

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

// One thing to embed: a text, or a local JPEG or PNG file.
export type EmbedInput = { text: string } | { imagePath: string };

// An input after its image file was read: what the body builders take.
export type ResolvedEmbedInput =
  | { text: string }
  | { image: { mediaType: "image/jpeg" | "image/png"; base64: string } };

// Cohere Embed v4 takes images up to 5 MB (png, jpeg, webp, gif). The Titan
// Multimodal page states no image size limit, so none is enforced for it.
// https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-embed-v4.html
const COHERE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Amazon Titan Multimodal Embeddings G1: { inputText?, inputImage? (base64) }, at
// least one of them; the text-only body is the same one Titan Text V2 takes.
// https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-embed-mm.html
export function buildTitanBody(input: ResolvedEmbedInput): Record<string, unknown> {
  return "text" in input ? { inputText: input.text } : { inputImage: input.image.base64 };
}

// Cohere Embed v4 (https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-embed-v4.html):
// texts only -> `texts`; images only -> `images` (data URIs); a mix -> `inputs`,
// one item per input, because `texts` and `images` cannot share a request.
export function buildCohereBody(inputs: ResolvedEmbedInput[]): Record<string, unknown> {
  const input_type = "search_document";
  const uri = (i: { image: { mediaType: string; base64: string } }) =>
    `data:${i.image.mediaType};base64,${i.image.base64}`;
  const texts = inputs.filter((i): i is { text: string } => "text" in i);
  if (texts.length === inputs.length) return { texts: texts.map((t) => t.text), input_type };
  if (texts.length === 0) {
    return { images: (inputs as Array<{ image: ResolvedImage }>).map(uri), input_type };
  }
  return {
    inputs: inputs.map((i) => ({
      content: [
        "text" in i
          ? { type: "text", text: i.text }
          : { type: "image_url", image_url: { url: uri(i) } },
      ],
    })),
    input_type,
  };
}

type ResolvedImage = { mediaType: "image/jpeg" | "image/png"; base64: string };

async function readEmbedImage(path: string, maxBytes?: number): Promise<ResolvedImage> {
  const { full, bytes, mediaType } = await readImageFile(path);
  if (mediaType === "image/webp") throw new Error(`${full} is WebP; image embeddings take JPEG or PNG here`);
  if (maxBytes !== undefined && bytes.length > maxBytes) {
    throw new Error(`${full} is ${bytes.length} bytes; Cohere Embed v4 images can be up to 5 MB`);
  }
  return { mediaType, base64: bytes.toString("base64") };
}

// Registry lookup by alias or id, including inference profiles (us.cohere.embed-v4:0).
function findEmbeddingModel(modelId: string): EmbeddingModel | undefined {
  return getEmbeddingModel(modelId) ?? EMBEDDING_MODELS.find((m) => modelId === m.id || modelId.endsWith(`.${m.id}`));
}

export async function embed(modelId: string, texts: string[], signal?: AbortSignal): Promise<number[][]> {
  return embedInputs(modelId, texts.map((text) => ({ text })), signal);
}

// Amazon Titan embeds one input per call: { inputText } or { inputImage } ->
// { embedding: number[] }. Cohere embeds a batch. Embed v3 answers with
// { embeddings: number[][] }; Embed v4 keys them by type even when no type is
// asked for, { embeddings: { float: number[][] } } (probed 2026-11-01).
// One vector per input, in order.
export async function embedInputs(
  modelId: string,
  inputs: EmbedInput[],
  signal?: AbortSignal,
): Promise<number[][]> {
  // Matches the base id and its inference profiles (us.cohere.embed-v4:0).
  const isCohere = /(^|\.)cohere\./.test(modelId);

  // Read and check every image before any request goes out.
  const hasImage = inputs.some((i) => "imagePath" in i);
  if (hasImage) {
    const entry = findEmbeddingModel(modelId);
    if (entry?.modality !== "multimodal") {
      const multimodal = EMBEDDING_MODELS.filter((m) => m.modality === "multimodal")
        .map((m) => m.aliases[0])
        .join(", ");
      throw new Error(`${entry?.name ?? modelId} embeds text only. Image inputs need a multimodal model: ${multimodal}`);
    }
  }
  // One at a time, so a list of large files is never held in memory all at once.
  const resolved: ResolvedEmbedInput[] = [];
  for (const i of inputs) {
    resolved.push(
      "imagePath" in i
        ? { image: await readEmbedImage(i.imagePath, isCohere ? COHERE_MAX_IMAGE_BYTES : undefined) }
        : i,
    );
  }

  if (isCohere) {
    const res = (await invoke(modelId, buildCohereBody(resolved), signal)) as {
      embeddings?: number[][] | { float?: number[][] };
    };
    const vectors = Array.isArray(res.embeddings) ? res.embeddings : res.embeddings?.float;
    if (!vectors) throw new Error("Model returned no embeddings");
    return vectors;
  }

  // Titan: one request per input, TITAN_CONCURRENCY at a time, results kept in input order.
  const vectors: number[][] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    const i = next++;
    if (i >= resolved.length) return;
    const res = (await invoke(modelId, buildTitanBody(resolved[i]), signal)) as { embedding?: number[] };
    if (!res.embedding) throw new Error("Model returned no embedding");
    vectors[i] = res.embedding;
    return worker();
  };
  await Promise.all(Array.from({ length: Math.min(TITAN_CONCURRENCY, resolved.length) }, worker));
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
