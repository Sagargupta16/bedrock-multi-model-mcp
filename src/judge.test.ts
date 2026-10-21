import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConverseOptions, ConverseResult } from "./bedrock/converse.js";
import {
  assignLabels,
  buildJudgePrompt,
  buildVerdictSchema,
  formatJudgeReport,
  parseVerdict,
  runJudge,
} from "./judge.js";

// random() that always returns 0.99 keeps Fisher-Yates from moving anything.
const keepOrder = () => 0.99;

function fakeResult(modelId: string, text: string): ConverseResult {
  return { modelId, text, inputTokens: 10, outputTokens: 20, stopReason: "end_turn", latencyMs: 1500 };
}

test("assignLabels resolves aliases and labels A.. in shuffled order", () => {
  const fixed = assignLabels(["llama4", "nova-pro"], keepOrder);
  assert.deepEqual(fixed.map((c) => c.label), ["A", "B"]);
  assert.equal(fixed[1].modelId, "amazon.nova-pro-v1:0");
  assert.equal(fixed[1].name, "Nova Pro (Amazon)");

  // random() = 0 swaps every position with index 0, reversing a 2-item list.
  const swapped = assignLabels(["llama4", "nova-pro"], () => 0);
  assert.equal(swapped[0].modelId, "amazon.nova-pro-v1:0");
  assert.equal(swapped[0].label, "A");
});

test("buildJudgePrompt hides model names and asks for every label", () => {
  const prompt = buildJudgePrompt("What is 2+2?", [
    { label: "A", text: "4" },
    { label: "B", text: "five" },
  ]);
  assert.match(prompt, /<answer label="A">\n4\n<\/answer>/);
  assert.match(prompt, /"A": <1-10>, "B": <1-10>/);
  assert.doesNotMatch(prompt, /final_answer/);
  assert.match(buildJudgePrompt("q", [{ label: "A", text: "x" }], { synthesize: true }), /final_answer/);
});

test("parseVerdict reads JSON wrapped in prose or a code fence", () => {
  const text = 'Here you go:\n```json\n{"scores":{"A":9,"B":4},"winner":"a","reasoning":"A is right."}\n```';
  const v = parseVerdict(text, ["A", "B"]);
  assert.ok(v);
  assert.equal(v.winner, "A");
  assert.equal(v.scores.B, 4);
});

test("parseVerdict upper-cases score keys to match the labels", () => {
  const v = parseVerdict('{"scores":{"a":9," b ":4},"winner":"a","reasoning":"x"}', ["A", "B"]);
  assert.ok(v);
  assert.deepEqual(v.scores, { A: 9, B: 4 });
});

test("parseVerdict rejects malformed JSON and unknown winners", () => {
  assert.equal(parseVerdict("no json here", ["A", "B"]), undefined);
  assert.equal(parseVerdict('{"scores":{"A":9}', ["A"]), undefined);
  assert.equal(parseVerdict('{"scores":{"A":9},"winner":"C","reasoning":"x"}', ["A", "B"]), undefined);
  assert.equal(parseVerdict('{"winner":"A","reasoning":"x"}', ["A"]), undefined);
});

test("runJudge sends anonymous answers to the judge and maps the winner back", async () => {
  const calls: ConverseOptions[] = [];
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => {
    calls.push(o);
    if (o.modelId === "us.anthropic.claude-opus-5-5") {
      return fakeResult(o.modelId, '{"scores":{"A":3,"B":8},"winner":"B","reasoning":"B is correct."}');
    }
    return fakeResult(o.modelId, o.modelId.includes("nova") ? "nova says 4" : "llama says 5");
  };
  const report = await runJudge({ models: ["llama4", "nova-pro"], prompt: "2+2?" }, ask, keepOrder);

  assert.equal(calls.length, 3);
  const judgeCall = calls[2];
  assert.equal(judgeCall.temperature, 0);
  assert.doesNotMatch(judgeCall.prompt, /Llama|Nova/, "judge must not see model names");
  assert.equal(report.verdict?.winner, "B");

  const text = formatJudgeReport(report);
  assert.match(text, /## Winner: Nova Pro \(Amazon\)/);
  assert.match(text, /\| 1 \| Nova Pro \(Amazon\) \| 8\/10 \|/);
  assert.match(text, /### Answer A: Llama 4 Maverick/);
});

test("buildVerdictSchema scores every label and limits the winner to them", () => {
  const schema = buildVerdictSchema(["A", "B"]) as {
    properties: { scores: { required: string[] }; winner: { enum: string[] } };
    required: string[];
    additionalProperties: boolean;
  };
  assert.deepEqual(schema.properties.scores.required, ["A", "B"]);
  assert.deepEqual(schema.properties.winner.enum, ["A", "B"]);
  assert.deepEqual(schema.required, ["scores", "winner", "reasoning"]);
  assert.equal(schema.additionalProperties, false);
  assert.ok((buildVerdictSchema(["A"], true) as { required: string[] }).required.includes("final_answer"));
});

test("a structured-output judge gets the verdict schema; candidates get effort", async () => {
  const calls: ConverseOptions[] = [];
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => {
    calls.push(o);
    return o.schema
      ? fakeResult(o.modelId, '{"scores":{"A":7,"B":6},"winner":"A","reasoning":"A."}')
      : fakeResult(o.modelId, "an answer");
  };
  await runJudge({ models: ["claude-haiku", "nova-pro"], prompt: "q", effort: "low" }, ask, keepOrder);
  // Haiku 5.5 takes effort; Nova Pro does not, so it runs without it instead of failing.
  assert.deepEqual(calls.slice(0, 2).map((c) => c.effort), ["low", undefined]);
  assert.equal(calls.slice(0, 2).some((c) => c.schema), false, "candidates answer in free text");
  assert.equal(calls[2].modelId, "us.anthropic.claude-opus-5-5");
  assert.ok(calls[2].schema, "Opus 5.5 supports structured output, so the judge call carries the schema");

  // Nova Pro rejects outputConfig, so as a judge it is asked for JSON in the prompt only.
  calls.length = 0;
  await runJudge({ models: ["llama4", "deepseek"], prompt: "q", judge: "nova-pro" }, ask, keepOrder);
  assert.equal(calls[2].modelId, "amazon.nova-pro-v1:0");
  assert.equal(calls[2].schema, undefined);
});

test("a tied top score ranks the judge's winner first", async () => {
  // A and B tie at 9/10 and the judge picks B, which comes second in label order.
  const ask = async (o: ConverseOptions): Promise<ConverseResult> =>
    o.modelId.includes("opus")
      ? fakeResult(o.modelId, '{"scores":{"A":9,"B":9},"winner":"B","reasoning":"B is tighter."}')
      : fakeResult(o.modelId, "same answer");
  const text = formatJudgeReport(
    await runJudge({ models: ["llama4", "nova-pro"], prompt: "q" }, ask, keepOrder),
  );
  assert.match(text, /## Winner: Nova Pro \(Amazon\)/);
  assert.match(text, /\| 1 \| Nova Pro \(Amazon\) \| 9\/10 \|/);
  assert.match(text, /\| 2 \| Llama 4 Maverick 17B \(Meta\) \| 9\/10 \|/);
});

test("runJudge reports failed candidates and skips the judge when one answer is left", async () => {
  let judged = false;
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => {
    if (o.modelId.includes("nova")) throw new Error("AccessDeniedException: no access");
    if (o.modelId.includes("opus")) judged = true;
    return fakeResult(o.modelId, "only answer");
  };
  const report = await runJudge({ models: ["llama4", "nova-pro"], prompt: "q" }, ask, keepOrder);
  assert.equal(judged, false);
  const text = formatJudgeReport(report);
  assert.match(text, /Only Llama 4 Maverick 17B \(Meta\) answered/);
  assert.match(text, /\*\*Failed:\*\* Nova Pro \(Amazon\) - AccessDeniedException/);
});

test("runJudge throws when no candidate answers", async () => {
  const ask = async (): Promise<ConverseResult> => {
    throw new Error("ThrottlingException");
  };
  await assert.rejects(
    runJudge({ models: ["llama4", "nova-pro"], prompt: "q" }, ask, keepOrder),
    /No candidate model answered/,
  );
});

test("a failed judge call still returns the candidate answers", async () => {
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => {
    if (o.modelId.includes("opus")) throw new Error("ModelTimeoutException");
    return fakeResult(o.modelId, `answer from ${o.modelId}`);
  };
  const text = formatJudgeReport(
    await runJudge({ models: ["llama4", "nova-pro"], prompt: "q" }, ask, keepOrder),
  );
  assert.match(text, /Judge Claude Opus 5\.5 \(Anthropic\) failed/);
  assert.match(text, /answer from amazon\.nova-pro-v1:0/);
});

test("an unparsable verdict falls back to the raw judge text with the label key", async () => {
  const ask = async (o: ConverseOptions): Promise<ConverseResult> =>
    fakeResult(o.modelId, o.modelId.includes("opus") ? "I prefer the second one." : "x");
  const text = formatJudgeReport(
    await runJudge({ models: ["llama4", "nova-pro"], prompt: "q" }, ask, keepOrder),
  );
  assert.match(text, /did not return a parsable verdict/);
  assert.match(text, /A = Llama 4 Maverick 17B \(Meta\), B = Nova Pro \(Amazon\)/);
  assert.match(text, /I prefer the second one\./);
});
