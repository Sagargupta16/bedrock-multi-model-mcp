import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEXT_MODELS,
  MODEL_REGISTRY,
  MODEL_ALIASES,
  resolveModelId,
  getModelInfo,
} from "./models.js";
import { IMAGE_MODELS, getImageModel } from "./bedrock/image.js";
import { EMBEDDING_MODELS, getEmbeddingModel, cosineSimilarity } from "./bedrock/embed.js";

test("text registry loads and validates", () => {
  assert.ok(TEXT_MODELS.length > 0, "registry should not be empty");
});

test("every alias resolves to a model in the registry", () => {
  // This is the guard that would have caught the broken claude-sonnet alias
  // pointing at a model id that no longer existed.
  for (const [alias, id] of Object.entries(MODEL_ALIASES)) {
    assert.ok(MODEL_REGISTRY[id], `alias "${alias}" -> "${id}" must exist in registry`);
  }
});

test("model ids are unique", () => {
  const ids = TEXT_MODELS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate model id in registry");
});

test("aliases are unique across all models", () => {
  const aliases = TEXT_MODELS.flatMap((m) => m.aliases);
  assert.equal(new Set(aliases).size, aliases.length, "duplicate alias across models");
});

test("resolveModelId maps alias to id, passes through full ids", () => {
  assert.equal(resolveModelId("claude-sonnet"), "us.anthropic.claude-sonnet-4-6");
  assert.equal(resolveModelId("CLAUDE-SONNET"), "us.anthropic.claude-sonnet-4-6");
  assert.equal(resolveModelId("some.unknown.model-id"), "some.unknown.model-id");
});

test("getModelInfo returns metadata for known ids", () => {
  const info = getModelInfo("us.anthropic.claude-opus-4-8");
  assert.equal(info?.name, "Claude Opus 4.8");
  assert.equal(info?.noTemperature, true);
});

test("image registry loads and aliases resolve", () => {
  assert.ok(IMAGE_MODELS.length > 0, "image registry should not be empty");
  assert.equal(getImageModel("nova-canvas")?.id, "amazon.nova-canvas-v1:0");
  assert.equal(getImageModel("titan-image")?.id, "amazon.titan-image-generator-v2:0");
});

test("embedding registry loads and aliases resolve", () => {
  assert.ok(EMBEDDING_MODELS.length > 0, "embedding registry should not be empty");
  assert.equal(getEmbeddingModel("titan-v2")?.id, "amazon.titan-embed-text-v2:0");
  assert.equal(getEmbeddingModel("cohere-en")?.id, "cohere.embed-english-v3");
});

test("cosineSimilarity: identical=1, orthogonal=0, opposite=-1", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0, "zero vector guards against NaN");
});
