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
import { VIDEO_MODELS, getVideoModel } from "./bedrock/video.js";
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
  assert.equal(getImageModel("sd3.5")?.id, "stability.sd3-5-large-v1:0");
  assert.equal(getImageModel("stable-core")?.id, "stability.stable-image-core-v1:1");
  assert.equal(getImageModel("stable-ultra")?.id, "stability.stable-image-ultra-v1:1");
  // A full model ID must resolve too, so it gets the correct `format`
  // (else a Stability model receives an Amazon-shaped request and fails).
  assert.equal(
    getImageModel("stability.stable-image-ultra-v1:1")?.format,
    "stability",
  );
});

test("registries contain no AWS-legacy models", () => {
  // AWS lifecycle scan 2026-06-10: nova-canvas, nova-reel, titan-image,
  // jamba-1-5, nova-premier are LEGACY. Keep them out of the registries.
  const legacy = /nova-canvas|nova-reel|titan-image|jamba-1-5|nova-premier/;
  for (const m of [...IMAGE_MODELS, ...VIDEO_MODELS, ...TEXT_MODELS]) {
    assert.ok(!legacy.test(m.id), `${m.id} is AWS-legacy and must not ship`);
  }
});

test("stability image models declare format and region", () => {
  for (const m of IMAGE_MODELS.filter((m) => m.provider === "Stability AI")) {
    assert.equal(m.format, "stability", `${m.id} must use the stability request format`);
    assert.equal(m.region, "us-west-2", `${m.id} is only served from us-west-2`);
  }
});

test("video registry loads and aliases resolve", () => {
  assert.ok(VIDEO_MODELS.length > 0, "video registry should not be empty");
  assert.equal(getVideoModel("luma-ray")?.id, "luma.ray-v2:0");
  assert.equal(getVideoModel("ray2")?.id, "luma.ray-v2:0");
});

test("fable-5 alias resolves to the global inference profile", () => {
  assert.equal(resolveModelId("fable"), "global.anthropic.claude-fable-5");
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
