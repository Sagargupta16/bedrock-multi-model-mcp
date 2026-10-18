#!/usr/bin/env node
// Latency and throughput benchmark across every text model in the registry.
//
//   npm run build
//   node scripts/benchmark.mjs                     # all models, 3 runs per prompt
//   node scripts/benchmark.mjs --runs 1 --models nova-micro,llama4
//   node scripts/benchmark.mjs --from docs/benchmark/results.json   # re-render only, no calls
//
// Each model gets the same fixed prompts, with temperature 0 where the model
// accepts it and a 256-token output cap, through the same converse() the MCP
// tools use. Models run sequentially within a worker so one model's calls never
// overlap; up to --concurrency workers run different models at once (each
// model has its own Bedrock quota).
//
// Latency is client wall-clock time for the whole Converse call, so it includes
// the network path from wherever this runs to the Bedrock region. Compare
// models within one run, not across machines.
//
// Writes docs/benchmark/results.json (every call) and docs/benchmark/RESULTS.md
// (the summary table), and refreshes the table between the benchmark markers
// in README.md. Every call is billed by AWS at the model's normal rate.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TEXT_MODELS, resolveModelId, getModelInfo } from "../dist/models.js";
import { converse } from "../dist/bedrock/converse.js";

const PROMPTS = [
  {
    id: "explain",
    text: "Explain what a message queue is to a junior developer in exactly three sentences.",
  },
  {
    id: "code",
    text: "Write a Python function is_palindrome(s) that ignores case and non-alphanumeric characters. Reply with only the code.",
  },
];
const MAX_TOKENS = 256;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const runs = Number(arg("runs", "3"));
const concurrency = Number(arg("concurrency", "4"));
const only = arg("models", "");
const from = arg("from", "");

const median = (xs) => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Runs fn over items one at a time, in order, and collects the results.
function inSeries(items, fn) {
  return items.reduce(
    (prev, item) => prev.then(async (out) => [...out, await fn(item)]),
    Promise.resolve([]),
  );
}

async function benchCall(modelId, prompt, run) {
  try {
    const r = await converse({ modelId, prompt: prompt.text, temperature: 0, maxTokens: MAX_TOKENS });
    return {
      modelId,
      prompt: prompt.id,
      run,
      ok: true,
      latencyMs: r.latencyMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      stopReason: r.stopReason,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    const message = err instanceof Error ? err.message : String(err);
    return { modelId, prompt: prompt.id, run, ok: false, error: `${name}: ${message}`.slice(0, 200) };
  }
}

async function benchModel(modelId) {
  const jobs = PROMPTS.flatMap((prompt) =>
    Array.from({ length: runs }, (_, i) => ({ prompt, run: i + 1 })),
  );
  const calls = await inSeries(jobs, ({ prompt, run }) => benchCall(modelId, prompt, run));
  const ok = calls.filter((c) => c.ok);
  process.stderr.write(`${modelId}: ${ok.length}/${calls.length} ok\n`);
  return calls;
}

async function measure() {
  const models = only
    ? only.split(",").map((m) => resolveModelId(m.trim()))
    : TEXT_MODELS.map((m) => m.id);
  const date = new Date().toISOString().slice(0, 10);
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
  const queue = [...models];
  const calls = [];
  // Each worker takes the next model off the shared queue until it is empty.
  const worker = async () => {
    const modelId = queue.shift();
    if (modelId === undefined) return;
    calls.push(...(await benchModel(modelId)));
    await worker();
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { date, region, runs, maxTokens: MAX_TOKENS, prompts: PROMPTS, models, calls };
}

function summarize(data) {
  const models = data.models ?? [...new Set(data.calls.map((c) => c.modelId))];
  return models.map((modelId) => {
    const info = getModelInfo(modelId);
    const calls = data.calls.filter((c) => c.modelId === modelId);
    const ok = calls.filter((c) => c.ok);
    return {
      modelId,
      name: info ? info.name : modelId,
      provider: info ? info.provider : "-",
      ok: ok.length,
      total: calls.length,
      medianLatencyMs: median(ok.map((c) => c.latencyMs)),
      medianOutputTokens: median(ok.map((c) => c.outputTokens)),
      medianTokensPerSec: median(
        ok.filter((c) => c.latencyMs > 0).map((c) => (c.outputTokens / c.latencyMs) * 1000),
      ),
      hitCap: ok.filter((c) => c.stopReason === "max_tokens").length,
      firstError: calls.find((c) => !c.ok)?.error,
    };
  });
}

function render(data, rows) {
  const answered = rows.filter((r) => r.ok > 0).sort((a, b) => a.medianLatencyMs - b.medianLatencyMs);
  const failed = rows.filter((r) => r.ok === 0);
  const okCalls = data.calls.filter((c) => c.ok).length;
  const fmt = (n, digits = 1) => (n === undefined ? "-" : n.toFixed(digits));

  const lines = [
    `Measured ${data.date} in ${data.region} by \`scripts/benchmark.mjs\`: ${data.prompts.length} prompts x ` +
      `${data.runs} runs per model, temperature 0 where accepted, ${data.maxTokens}-token output cap. ` +
      `${answered.length} of ${rows.length} models answered, ${okCalls} of ${data.calls.length} calls succeeded. ` +
      `Latency is the median client wall-clock time for the whole call, sorted fastest first. ` +
      `"Hit cap" counts answers cut off at ${data.maxTokens} tokens, which also caps their token counts.`,
    "",
    "| Model | Provider | Median latency (s) | Median output tokens | Median output tokens/s | Hit cap | OK |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...answered.map(
      (r) =>
        `| ${r.name} | ${r.provider} | ${fmt(r.medianLatencyMs / 1000, 2)} | ${fmt(r.medianOutputTokens, 0)} | ` +
        `${fmt(r.medianTokensPerSec, 0)} | ${r.hitCap} | ${r.ok}/${r.total} |`,
    ),
  ];
  if (failed.length > 0) {
    lines.push("", "Did not answer on this account:", "");
    for (const r of failed) lines.push(`- ${r.name}: \`${(r.firstError ?? "").split(":")[0]}\``);
  }
  return lines.join("\n");
}

const eolOf = (text) => (text.includes("\r\n") ? "\r\n" : "\n");

// Writes text with the line endings the file already has (CRLF on a Windows
// checkout), so a re-render only shows real content changes in git.
function writeKeepingEol(path, text) {
  const eol = existsSync(path) ? eolOf(readFileSync(path, "utf-8")) : "\n";
  writeFileSync(path, eol === "\n" ? text : text.replaceAll("\n", eol));
}

function writeOutputs(data, rows, markdown) {
  const outDir = fileURLToPath(new URL("../docs/benchmark/", import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const { date, region, runs: r, maxTokens, prompts, calls } = data;
  const models = data.models ?? rows.map((row) => row.modelId);
  // The table rounds tokens/s itself; the JSON keeps one decimal, which is
  // plenty for a median and keeps long floats out of the file.
  const summary = rows.map((row) => ({
    ...row,
    medianTokensPerSec:
      row.medianTokensPerSec === undefined ? undefined : Math.round(row.medianTokensPerSec * 10) / 10,
  }));
  const json = JSON.stringify({ date, region, runs: r, maxTokens, prompts, models, summary, calls }, null, 2);
  writeKeepingEol(`${outDir}results.json`, `${json}\n`);
  writeKeepingEol(`${outDir}RESULTS.md`, `# Benchmark results\n\n${markdown}\n`);

  const readmePath = fileURLToPath(new URL("../README.md", import.meta.url));
  const readme = readFileSync(readmePath, "utf-8");
  const eol = eolOf(readme);
  const start = "<!-- benchmark:start -->";
  const end = "<!-- benchmark:end -->";
  const a = readme.indexOf(start);
  const b = readme.indexOf(end);
  if (a !== -1 && b > a) {
    const block = `${start}${eol}${markdown.replaceAll("\n", eol)}${eol}${end}`;
    writeFileSync(readmePath, readme.slice(0, a) + block + readme.slice(b + end.length));
  }
}

const data = from ? JSON.parse(readFileSync(from, "utf-8")) : await measure();
const rows = summarize(data);
const markdown = render(data, rows);
writeOutputs(data, rows, markdown);
console.log(markdown);
