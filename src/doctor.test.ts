import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConverseOptions, ConverseResult } from "./bedrock/converse.js";
import { classifyError, formatDoctorReport, runDoctor, type DoctorReport } from "./doctor.js";
import { TEXT_MODELS } from "./models.js";

function named(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

function okResult(o: ConverseOptions, text = "ok"): ConverseResult {
  return { modelId: o.modelId, text, inputTokens: 5, outputTokens: 1, stopReason: "end_turn", latencyMs: 7 };
}

test("classifyError maps each status", () => {
  assert.equal(classifyError(named("ThrottlingException", "slow down")).status, "throttled");
  assert.equal(classifyError(named("ServiceQuotaExceededException", "quota")).status, "throttled");
  assert.equal(classifyError(new Error("Too many tokens, please wait")).status, "throttled");
  assert.equal(classifyError(new Error("HTTP 429 Too many requests")).status, "throttled");
  assert.equal(classifyError(named("AccessDeniedException", "nope")).status, "denied");
  assert.equal(classifyError(new Error("You don't have access to the model")).status, "denied");
  assert.equal(classifyError(new Error("caller is not authorized")).status, "denied");
  assert.equal(
    classifyError(named("ValidationException", "The provided model identifier is invalid.")).status,
    "invalid",
  );
  assert.equal(classifyError(named("ResourceNotFoundException", "gone")).status, "invalid");
  assert.equal(
    classifyError(named("ValidationException", "Invocation of model ID x with on-demand throughput isn't supported."))
      .status,
    "invalid",
  );
  // A rejected parameter is not an unknown model.
  assert.equal(
    classifyError(named("ValidationException", "temperature is not supported for this model")).status,
    "error",
  );
  // bedrock-mantle errors carry only the HTTP status.
  assert.equal(classifyError(new Error("bedrock-mantle error (429): Rate limit exceeded")).status, "throttled");
  assert.equal(classifyError(new Error("bedrock-mantle error (401): bad token")).status, "denied");
  assert.equal(classifyError(new Error("bedrock-mantle error (403): forbidden")).status, "denied");
  assert.equal(classifyError(new Error("bedrock-mantle error (404): no such model")).status, "invalid");
  assert.equal(classifyError(new Error("bedrock-mantle error (500): boom")).status, "error");
  assert.equal(classifyError(named("InternalServerException", "boom")).status, "error");
  assert.equal(classifyError("plain string").status, "error");
});

test("classifyError keeps the first line, cut to 160 characters", () => {
  const c = classifyError(new Error(`${"x".repeat(300)}\nsecond line`));
  assert.equal(c.note.length, 160);
  assert.equal(classifyError(new Error("one\ntwo")).note, "one");
});

test("runDoctor probes every registry model in registry order and classifies failures", async () => {
  const failing = new Map<string, Error>([
    [TEXT_MODELS[1].id, named("ThrottlingException", "Too many requests")],
    [TEXT_MODELS[2].id, named("AccessDeniedException", "not authorized")],
  ]);
  const seen: ConverseOptions[] = [];
  const report = await runDoctor({}, async (o) => {
    seen.push(o);
    // Earlier models finish last, so completion order differs from registry order.
    await new Promise((r) => setTimeout(r, TEXT_MODELS.findIndex((m) => m.id === o.modelId) % 3));
    const err = failing.get(o.modelId);
    if (err) throw err;
    return okResult(o, o.modelId === TEXT_MODELS[3].id ? "" : "ok");
  });
  assert.deepEqual(report.rows.map((r) => r.modelId), TEXT_MODELS.map((m) => m.id));
  assert.equal(report.rows[0].alias, TEXT_MODELS[0].aliases[0]);
  assert.equal(report.rows[1].status, "throttled");
  assert.equal(report.rows[2].status, "denied");
  assert.equal(report.rows[3].status, "ok");
  assert.equal(report.rows[3].note, "empty reply");
  assert.equal(report.counts.throttled, 1);
  assert.equal(report.counts.denied, 1);
  assert.equal(report.counts.ok, TEXT_MODELS.length - 2);
  assert.ok(seen.every((o) => o.maxTokens === 32 && o.system === undefined && /single word: ok/.test(o.prompt)));
});

test("runDoctor never exceeds the concurrency limit and clamps it to 1..8", async () => {
  async function peak(concurrency: number): Promise<number> {
    let inFlight = 0;
    let max = 0;
    await runDoctor({ concurrency }, async (o) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return okResult(o);
    });
    return max;
  }
  assert.ok((await peak(2)) <= 2);
  assert.equal(await peak(0), 1);
  assert.ok((await peak(100)) <= 8);
  assert.ok((await peak(undefined as unknown as number)) <= 4);
});

test("runDoctor resolves a models subset from aliases and reports unknown ones as invalid", async () => {
  const calls: string[] = [];
  const alias = TEXT_MODELS[2].aliases[0];
  const report = await runDoctor({ models: [alias, "no-such-model-xyz", TEXT_MODELS[0].id] }, async (o) => {
    calls.push(o.modelId);
    return okResult(o);
  });
  assert.deepEqual(calls, [TEXT_MODELS[2].id, TEXT_MODELS[0].id]);
  assert.deepEqual(report.rows.map((r) => r.status), ["ok", "invalid", "ok"]);
  assert.equal(report.rows[1].alias, "no-such-model-xyz");
  assert.equal(report.counts.invalid, 1);
});

test("runDoctor stops launching probes once the signal is aborted", async () => {
  const ctrl = new AbortController();
  let calls = 0;
  const report = await runDoctor({ concurrency: 1, signal: ctrl.signal }, async (o) => {
    calls++;
    ctrl.abort();
    return okResult(o);
  });
  assert.equal(calls, 1);
  assert.equal(report.rows.length, 1);
  assert.equal(report.skipped, TEXT_MODELS.length - 1);
  assert.match(formatDoctorReport(report), /\(cancelled: \d+ not probed\)$/);
});

test("runDoctor probes a repeated model once, whatever alias names it", async () => {
  let calls = 0;
  const entry = TEXT_MODELS[0];
  const report = await runDoctor({ models: [entry.aliases[0], entry.id, entry.aliases[0]] }, async (o) => {
    calls++;
    return okResult(o);
  });
  assert.equal(calls, 1);
  assert.equal(report.rows.length, 1);
  assert.equal(report.skipped, undefined);
});

test("formatDoctorReport renders a table and a totals line", () => {
  const report: DoctorReport = {
    rows: [
      { alias: "a", modelId: "m.a", name: "A", status: "ok", latencyMs: 120 },
      { alias: "b", modelId: "m.b", name: "B", status: "throttled", latencyMs: 30, note: "Too many requests" },
      { alias: "c", modelId: "m.c", name: "C", status: "denied", latencyMs: 40, note: "a|b" },
    ],
    counts: { ok: 1, throttled: 1, denied: 1, invalid: 0, error: 0 },
    totalMs: 12400,
  };
  const text = formatDoctorReport(report);
  assert.match(text, /^\| alias \| model id \| status \| ms \| note \|/);
  assert.match(text, /\| a \| m\.a \| ok \| 120 \| {2}\|/);
  assert.match(text, /\| c \| m\.c \| denied \| 40 \| a\\\|b \|/);
  assert.ok(text.endsWith("1 ok, 1 throttled, 1 denied of 3 models in 12.4s"));
});

test("formatDoctorReport escapes backslashes as well as pipes in a note", () => {
  const report: DoctorReport = {
    rows: [{ alias: "a", modelId: "m.a", name: "A", status: "error", latencyMs: 5, note: "C:\\tmp\\x | y" }],
    counts: { ok: 0, throttled: 0, denied: 0, invalid: 0, error: 1 },
    totalMs: 5,
  };
  assert.ok(formatDoctorReport(report).includes("| C:\\\\tmp\\\\x \\| y |"));
});
