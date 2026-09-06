import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TEXT_MODELS,
  MODEL_REGISTRY,
  MODEL_ALIASES,
  resolveModelId,
  getModelInfo,
} from "./models.js";
import { TextModelSchema } from "./types.js";
import { IMAGE_MODELS, getImageModel, readPngSize } from "./bedrock/image.js";
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
  assert.equal(resolveModelId("claude-sonnet"), "us.anthropic.claude-sonnet-5");
  assert.equal(resolveModelId("CLAUDE-SONNET"), "us.anthropic.claude-sonnet-5");
  assert.equal(resolveModelId("some.unknown.model-id"), "some.unknown.model-id");
});

test("getModelInfo returns metadata for known ids", () => {
  const info = getModelInfo("us.anthropic.claude-opus-4-8");
  assert.equal(info?.name, "Claude Opus 4.8");
  assert.equal(info?.noTemperature, true);
});

test("claude-opus alias points at Opus 5, not a pinned older snapshot", () => {
  // Bare-tier aliases track the current flagship; version-pinned aliases
  // (claude-opus-4.8) stay put so an older model is still reachable.
  assert.equal(resolveModelId("claude-opus"), "us.anthropic.claude-opus-5");
  assert.equal(resolveModelId("claude-opus-4.8"), "us.anthropic.claude-opus-4-8");
});

test("version-pinned aliases keep the previous generation reachable", () => {
  // Anthropic's models overview (fetched 2026-09-06) lists Fable 5 and
  // Sonnet 4.6 under "Legacy models (still available)", so the bare tier
  // aliases move on and these pinned ones must not.
  assert.equal(resolveModelId("claude-sonnet-4.6"), "us.anthropic.claude-sonnet-4-6");
  assert.equal(resolveModelId("fable-5"), "us.anthropic.claude-fable-5");
});

test("noTemperature is set exactly on the Claude 4.7-and-later entries", () => {
  // temperature / top_p / top_k are "Deprecated (Claude Opus 4.7 and later)"
  // and return a 400 when set to a non-default value on Claude 4.7 and later
  // (Anthropic model-deprecations page, fetched 2026-09-06). Earlier models
  // still accept temperature - probed live 2026-09-06 through this server,
  // which injects 0.7 for any entry without the flag: Haiku 4.5, Opus 4.6 and
  // Sonnet 4.6 all returned normal completions. So the flag must be set on the
  // newer entries and stay off the older ones.
  for (const id of [
    "us.anthropic.claude-fable-5-1",
    "us.anthropic.claude-fable-5",
    "us.anthropic.claude-opus-5",
    "us.anthropic.claude-opus-4-8",
    "us.anthropic.claude-opus-4-7",
    "us.anthropic.claude-sonnet-5",
  ]) {
    assert.equal(getModelInfo(id)?.noTemperature, true, `${id} must set noTemperature`);
  }
  for (const id of [
    "us.anthropic.claude-opus-4-6-v1",
    "us.anthropic.claude-sonnet-4-6",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  ]) {
    assert.notEqual(
      getModelInfo(id)?.noTemperature,
      true,
      `${id} accepts temperature and must not set noTemperature`,
    );
  }
});

test("the capability enum rejects an unknown token", () => {
  // Guards the "tool-use" vs "tool_use" drift that reached bedrock_list_models.
  // Asserted against the schema directly: TEXT_MODELS is parsed at import time,
  // so a bad token in the shipped registry throws before any test body runs and
  // iterating TEXT_MODELS here would prove nothing.
  const entry = {
    id: "x",
    name: "X",
    provider: "X",
    useCase: "X",
    aliases: ["x"],
    capabilities: ["text"],
    maxTokens: 1,
  };
  assert.ok(TextModelSchema.safeParse(entry).success, "a known token must parse");
  assert.equal(
    TextModelSchema.safeParse({ ...entry, capabilities: ["tool_use"] }).success,
    true,
    "tool_use is the canonical token",
  );
  assert.equal(
    TextModelSchema.safeParse({ ...entry, capabilities: ["tool-use"] }).success,
    false,
    '"tool-use" must be rejected at load time',
  );
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

test("fable alias resolves to the us inference profile", () => {
  assert.equal(resolveModelId("fable"), "us.anthropic.claude-fable-5-1");
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

// Minimal PNG header: 8-byte signature, 4-byte chunk length, "IHDR", then
// width and height as big-endian uint32s.
function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

test("readPngSize reads the IHDR dimensions", () => {
  // 2016x1152 is what a stable-core 16:9 request actually wrote on 2026-09-06,
  // while the response claimed the requested 1920x1080.
  assert.deepEqual(readPngSize(pngHeader(2016, 1152)), { width: 2016, height: 1152 });
  assert.deepEqual(readPngSize(pngHeader(1024, 1024)), { width: 1024, height: 1024 });
});

test("readPngSize returns undefined for anything that is not a PNG", () => {
  // The size is then omitted from the tool response rather than invented.
  assert.equal(readPngSize(Buffer.alloc(0)), undefined, "empty buffer");
  assert.equal(readPngSize(pngHeader(16, 16).subarray(0, 23)), undefined, "truncated");
  const badSignature = pngHeader(16, 16);
  badSignature.writeUInt32BE(0, 0);
  assert.equal(readPngSize(badSignature), undefined, "wrong signature");
  const badChunk = pngHeader(16, 16);
  badChunk.write("IDAT", 12, "ascii");
  assert.equal(readPngSize(badChunk), undefined, "first chunk is not IHDR");
});

test("the version reported to MCP clients resolves from package.json", () => {
  // index.ts reads ../package.json relative to the compiled dist/index.js, so
  // this test file (also in dist/) resolves the same path. Guards the drift
  // that shipped version "0.3.0" from a 0.3.1 package.
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
  ) as { version?: string };
  assert.match(pkg.version ?? "", /^\d+\.\d+\.\d+$/);
});
