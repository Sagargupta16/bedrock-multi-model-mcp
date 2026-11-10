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
import { EDIT_MODELS, getEditModel } from "./bedrock/edit.js";

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
  assert.equal(resolveModelId("claude-sonnet"), "us.anthropic.claude-sonnet-5-5");
  assert.equal(resolveModelId("CLAUDE-SONNET"), "us.anthropic.claude-sonnet-5-5");
  assert.equal(resolveModelId("some.unknown.model-id"), "some.unknown.model-id");
});

test("getModelInfo returns metadata for known ids", () => {
  const info = getModelInfo("us.anthropic.claude-opus-5");
  assert.equal(info?.name, "Claude Opus 5");
  assert.equal(info?.noTemperature, true);
});

test("bare-tier Claude aliases point at the 5.5 generation", () => {
  // Bare-tier aliases track the current model in each tier; version-pinned
  // aliases (claude-opus-5, claude-opus-4.6) stay put so older models stay reachable.
  assert.equal(resolveModelId("claude-opus"), "us.anthropic.claude-opus-5-5");
  assert.equal(resolveModelId("claude-haiku"), "us.anthropic.claude-haiku-5-5");
  assert.equal(resolveModelId("claude-opus-5"), "us.anthropic.claude-opus-5");
  assert.equal(resolveModelId("claude-opus-4.6"), "us.anthropic.claude-opus-4-6-v1");
});

test("aliases of the models added on 2026-11-01 resolve to the probed ids", () => {
  // Each id answered a live Converse call on 2026-11-01 before it was added.
  const expected: Record<string, string> = {
    "gpt-sol": "us.openai.gpt-6.1-sol",
    "gpt-terra": "us.openai.gpt-6.1-terra",
    grok: "us.xai.grok-4.7",
    kimi: "us.moonshotai.kimi-k3",
    minimax: "minimax.minimax-m2.5",
    nemotron: "nvidia.nemotron-super-3-120b",
    ministral: "mistral.ministral-3-14b-instruct",
    magistral: "mistral.magistral-small-2509",
    "qwen-next": "qwen.qwen3-next-80b-a3b",
    gemma: "google.gemma-4-31b",
    "gemma-4-26b": "google.gemma-4-26b-a4b",
    "gemma-4-e2b": "google.gemma-4-e2b",
  };
  for (const [alias, id] of Object.entries(expected)) {
    assert.equal(resolveModelId(alias), id, `${alias} alias`);
  }
});

test("aliases of the models added on 2026-11-10 resolve to the probed ids", () => {
  // Each id answered a live Converse call on 2026-11-10 before it was added.
  // Bare `fable` moved to 5.2; `fable-5.1` keeps the previous one reachable.
  assert.equal(resolveModelId("fable"), "us.anthropic.claude-fable-5-2");
  assert.equal(resolveModelId("fable-5.1"), "us.anthropic.claude-fable-5-1");
  assert.equal(resolveModelId("gpt-astra"), "us.openai.gpt-6-astra");
  assert.equal(resolveModelId("gpt-luna"), "us.openai.gpt-6-luna");
});

test("only the Gemma 4 entries are served through bedrock-mantle", () => {
  // AWS model cards (read 2026-11-01): Gemma 4 is on bedrock-mantle only, with no
  // Converse support; every other registry model answers through Converse.
  for (const m of TEXT_MODELS) {
    assert.equal(m.api === "mantle", m.provider === "Google", `${m.id} api`);
  }
});

test("version-pinned aliases keep the previous generation reachable", () => {
  // The bare tier aliases move on with each release and these pinned ones must
  // not. Fable 5 left the registry in 0.8.0, two versions behind Fable 5.2.
  assert.equal(resolveModelId("claude-sonnet-4.6"), "us.anthropic.claude-sonnet-4-6");
  assert.equal(resolveModelId("claude-fable-5.1"), "us.anthropic.claude-fable-5-1");
  assert.equal(resolveModelId("claude-sonnet-5"), "us.anthropic.claude-sonnet-5");
  assert.equal(resolveModelId("claude-haiku-4.5"), "us.anthropic.claude-haiku-4-5-20251001-v1:0");
});

test("effort is flagged exactly on the models that accepted it live", () => {
  // Probed live with Converse outputConfig.effort: every Claude entry except
  // Haiku 4.5 answered on 2026-10-21, and GPT-6.1 Sol and Terra, Grok 4.7 and
  // Kimi K3 answered on 2026-11-01. Haiku 4.5 and every other Converse model
  // returned "This model doesn't support the effort field". The Gemma 4 models
  // (bedrock-mantle reasoning_effort) took low to xhigh on 2026-11-01. Fable 5.2,
  // GPT-6 Astra and GPT-6 Luna answered at low and at max on 2026-11-10.
  const accepted = new Set([
    "us.openai.gpt-6-astra",
    "us.openai.gpt-6-luna",
    "us.openai.gpt-6.1-sol",
    "us.openai.gpt-6.1-terra",
    "us.xai.grok-4.7",
    "us.moonshotai.kimi-k3",
    "google.gemma-4-31b",
    "google.gemma-4-26b-a4b",
    "google.gemma-4-e2b",
  ]);
  for (const m of TEXT_MODELS) {
    const expected =
      m.provider === "Anthropic"
        ? m.id !== "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        : accepted.has(m.id);
    assert.equal(!!m.effort, expected, `${m.id} effort flag`);
  }
});

test("structured_output is flagged exactly on the models that accepted it live", () => {
  // Probed 2026-10-21, and 2026-11-01 for the models added then: Converse
  // outputConfig.textFormat with a small schema on every registry model. Nova and
  // Pixtral rejected it with "This model doesn't support the outputConfig field".
  // Magistral Small accepted the field but ignored it (fenced JSON with a
  // different key). Every other model returned schema-shaped JSON.
  const rejected = new Set([
    "us.mistral.pixtral-large-2502-v1:0",
    "mistral.magistral-small-2509",
    "amazon.nova-pro-v1:0",
    "us.amazon.nova-2-lite-v1:0",
    "amazon.nova-lite-v1:0",
    "amazon.nova-micro-v1:0",
  ]);
  for (const m of TEXT_MODELS) {
    assert.equal(
      m.capabilities.includes("structured_output"),
      !rejected.has(m.id),
      `${m.id} structured_output flag`,
    );
  }
});

test("noTemperature is set exactly on the entries that rejected temperature live", () => {
  // temperature / top_p / top_k are "Deprecated (Claude Opus 4.7 and later)"
  // and return a 400 when set to a non-default value on Claude 4.7 and later
  // (Anthropic model-deprecations page, fetched 2026-09-06). Earlier models
  // still accept temperature - probed live 2026-09-06 through this server,
  // which injects 0.7 for any entry without the flag: Haiku 4.5, Opus 4.6 and
  // Sonnet 4.6 all returned normal completions. So the flag must be set on the
  // newer entries and stay off the older ones. The three 5.5 models returned
  // "`temperature` is deprecated for this model" when probed live 2026-10-21.
  // On 2026-11-01 GPT-6.1 Sol and Terra, Grok 4.7 and Kimi K3 returned "This
  // model doesn't support the temperature field", while MiniMax M2.5, Nemotron 3
  // Super, Ministral 3, Magistral Small and Qwen3 Next answered with it set.
  // On 2026-11-10 Fable 5.2, GPT-6 Astra and GPT-6 Luna rejected it the same way.
  for (const id of [
    "us.anthropic.claude-opus-5-5",
    "us.anthropic.claude-sonnet-5-5",
    "us.anthropic.claude-haiku-5-5",
    "us.anthropic.claude-fable-5-2",
    "us.anthropic.claude-fable-5-1",
    "us.anthropic.claude-opus-5",
    "us.anthropic.claude-sonnet-5",
    "us.openai.gpt-6-astra",
    "us.openai.gpt-6-luna",
    "us.openai.gpt-6.1-sol",
    "us.openai.gpt-6.1-terra",
    "us.xai.grok-4.7",
    "us.moonshotai.kimi-k3",
  ]) {
    assert.equal(getModelInfo(id)?.noTemperature, true, `${id} must set noTemperature`);
  }
  for (const id of [
    "us.anthropic.claude-opus-4-6-v1",
    "us.anthropic.claude-sonnet-4-6",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "minimax.minimax-m2.5",
    "nvidia.nemotron-super-3-120b",
    "mistral.ministral-3-14b-instruct",
    "mistral.magistral-small-2509",
    "qwen.qwen3-next-80b-a3b",
    "google.gemma-4-31b",
    "google.gemma-4-26b-a4b",
    "google.gemma-4-e2b",
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
  // A full model ID must resolve too, so it is sent to the model's own region.
  assert.equal(getImageModel("stability.stable-image-ultra-v1:1")?.region, "us-west-2");
});

test("registries contain no AWS-legacy models", () => {
  // Fixed ban list from past AWS lifecycle scans, so a retired id cannot come
  // back: 2026-06-10 (nova-canvas, nova-reel, titan-image, jamba-1-5,
  // nova-premier) and 2026-11-01 (Llama 4 Maverick and Scout, Llama 3.3 70B,
  // Devstral 2, DeepSeek R1, Legacy since 2026-09-30). New Legacy listings are
  // caught by scripts/check-lifecycle.mjs, which reads the live AWS page.
  const legacy =
    /nova-canvas|nova-reel|titan-image|jamba-1-5|nova-premier|llama4-maverick|llama4-scout|llama3-3-70b|devstral-2|deepseek\.r1/;
  for (const m of [...IMAGE_MODELS, ...EDIT_MODELS, ...VIDEO_MODELS, ...TEXT_MODELS, ...EMBEDDING_MODELS]) {
    assert.ok(!legacy.test(m.id), `${m.id} is AWS-legacy and must not ship`);
  }
});

test("image models declare the region they are served from", () => {
  for (const m of IMAGE_MODELS) {
    assert.equal(m.region, "us-west-2", `${m.id} is only served from us-west-2`);
  }
});

test("image-edit registry holds the 13 Stability image services on their US profile", () => {
  // AWS lists 13 Stability AI Image Services (model cards read 2026-11-01). They
  // are served only through the US geo inference profile, so every id is us.-prefixed.
  assert.equal(EDIT_MODELS.length, 13);
  const operations = EDIT_MODELS.map((m) => m.operation);
  assert.equal(new Set(operations).size, operations.length, "duplicate operation");
  for (const m of EDIT_MODELS) {
    assert.match(m.id, /^us\.stability\./, `${m.id} needs the us. profile`);
    assert.equal(m.region, "us-west-2", `${m.id} region`);
    assert.ok(!m.accepts.some((f) => m.requires.includes(f)), `${m.id} lists a field as both required and optional`);
  }
  assert.equal(getEditModel("inpaint")?.id, "us.stability.stable-image-inpaint-v1:0");
  assert.equal(getEditModel("style-transfer")?.imageField, "init_image");
  assert.deepEqual(getEditModel("outpaint")?.requiresOneOf, ["left", "right", "up", "down"]);
});

test("video registry loads and aliases resolve", () => {
  assert.ok(VIDEO_MODELS.length > 0, "video registry should not be empty");
  assert.equal(getVideoModel("luma-ray")?.id, "luma.ray-v2:0");
  assert.equal(getVideoModel("ray2")?.id, "luma.ray-v2:0");
});

test("fable alias resolves to the us inference profile", () => {
  assert.equal(resolveModelId("fable"), "us.anthropic.claude-fable-5-2");
});

test("embedding registry loads and aliases resolve", () => {
  assert.ok(EMBEDDING_MODELS.length > 0, "embedding registry should not be empty");
  assert.equal(getEmbeddingModel("titan-v2")?.id, "amazon.titan-embed-text-v2:0");
  assert.equal(getEmbeddingModel("cohere")?.id, "cohere.embed-v4:0");
  // The v3 aliases move to Embed v4, which covers English and multilingual text.
  assert.equal(getEmbeddingModel("cohere-en")?.id, "cohere.embed-v4:0");
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

test("server.json matches package.json name and version for the MCP Registry", () => {
  // The registry rejects a publish whose server.json name differs from the
  // npm package's mcpName, and the release workflow refuses a version skew.
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
  ) as { name: string; version: string; mcpName?: string };
  const server = JSON.parse(
    readFileSync(new URL("../server.json", import.meta.url), "utf-8"),
  ) as { name: string; version: string; description: string; packages: { identifier: string; version: string }[] };
  assert.equal(server.name, pkg.mcpName);
  assert.equal(server.version, pkg.version);
  assert.equal(server.packages[0].identifier, pkg.name);
  assert.equal(server.packages[0].version, pkg.version);
  assert.ok(server.description.length <= 100, "registry caps description at 100 characters");
});
