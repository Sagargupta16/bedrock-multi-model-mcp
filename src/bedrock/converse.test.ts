import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConverseInput, effortFor, parseJsonReply } from "./converse.js";

const schema = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
  additionalProperties: false,
};

test("effort and schema go in outputConfig, the schema as a JSON string", () => {
  const input = buildConverseInput({ modelId: "claude-haiku", prompt: "q", effort: "low", schema });
  assert.equal(input.modelId, "us.anthropic.claude-haiku-5-5");
  assert.equal(input.outputConfig?.effort, "low");
  assert.equal(input.outputConfig?.textFormat?.type, "json_schema");
  const jsonSchema = input.outputConfig?.textFormat?.structure?.jsonSchema;
  assert.equal(typeof jsonSchema?.schema, "string");
  assert.deepEqual(JSON.parse(jsonSchema!.schema!), schema);
  assert.equal(jsonSchema?.name, "response");
});

test("no outputConfig is sent when neither effort nor schema is set", () => {
  assert.equal(buildConverseInput({ modelId: "nova-pro", prompt: "q" }).outputConfig, undefined);
});

test("temperature is dropped for the 5.5 models and kept for Haiku 4.5", () => {
  const opus = buildConverseInput({ modelId: "claude-opus", prompt: "q", temperature: 0.2 });
  assert.equal(opus.inferenceConfig?.temperature, undefined);
  const haiku45 = buildConverseInput({ modelId: "claude-haiku-4.5", prompt: "q", temperature: 0.2 });
  assert.equal(haiku45.inferenceConfig?.temperature, 0.2);
});

test("unsupported options are rejected before a billed call", () => {
  assert.throws(
    () => buildConverseInput({ modelId: "claude-haiku-4.5", prompt: "q", effort: "high" }),
    /Claude Haiku 4\.5 does not take effort\. Models that do: .*Claude Opus 5\.5/,
  );
  assert.throws(
    () => buildConverseInput({ modelId: "nova-pro", prompt: "q", schema }),
    /Nova Pro does not support structured output\. Models that do: .*DeepSeek V3\.2/,
  );
});

test("effortFor keeps effort only for models that take it", () => {
  assert.equal(effortFor("claude-opus", "high"), "high");
  assert.equal(effortFor("nova-pro", "high"), undefined);
  assert.equal(effortFor("claude-haiku-4.5", "high"), undefined);
  assert.equal(effortFor("some.new-model-v1:0", "high"), "high", "unknown ids are left to Bedrock");
  assert.equal(effortFor("claude-opus", undefined), undefined);
});

test("an id outside the registry passes through for Bedrock to judge", () => {
  const input = buildConverseInput({ modelId: "some.new-model-v1:0", prompt: "q", effort: "low", schema });
  assert.equal(input.modelId, "some.new-model-v1:0");
  assert.equal(input.outputConfig?.effort, "low");
});

test("parseJsonReply reads plain JSON and skips a stray prefix", () => {
  assert.deepEqual(parseJsonReply('{"city":"Bengaluru"}'), { city: "Bengaluru" });
  // GPT-OSS on Bedrock returned this exact shape on 2026-10-21.
  assert.deepEqual(parseJsonReply('B{"city":"Bengaluru"}'), { city: "Bengaluru" });
  assert.deepEqual(parseJsonReply('[1, 2]'), [1, 2]);
  assert.equal(parseJsonReply("no json here"), undefined);
  assert.equal(parseJsonReply('{"city":'), undefined);
});
