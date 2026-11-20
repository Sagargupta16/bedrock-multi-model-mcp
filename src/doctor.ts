import { converse, type ConverseOptions, type ConverseResult } from "./bedrock/converse.js";
import { TEXT_MODELS, getModelInfo, resolveModelId } from "./models.js";

// bedrock_doctor: one tiny call to every registry text model, so the caller
// sees which models work on their AWS account, which are throttled right now
// and which are denied (no model access) or gone.

export type DoctorStatus = "ok" | "throttled" | "denied" | "invalid" | "error";

export interface DoctorRow {
  alias: string;
  modelId: string;
  name: string;
  status: DoctorStatus;
  latencyMs: number;
  note?: string;
}

export interface DoctorReport {
  rows: DoctorRow[];
  counts: Record<DoctorStatus, number>;
  totalMs: number;
  // Models never probed because the call was cancelled part way.
  skipped?: number;
}

export interface DoctorOptions {
  // Aliases or model ids; omitted means every registry text model.
  models?: string[];
  // Parallel probes, clamped to 1..8 (default 4).
  concurrency?: number;
  signal?: AbortSignal;
}

export type AskFn = (options: ConverseOptions) => Promise<ConverseResult>;

const PROBE_PROMPT = "Reply with the single word: ok";
const DEFAULT_CONCURRENCY = 4;
const NOTE_MAX = 160;
const STATUSES: DoctorStatus[] = ["ok", "throttled", "denied", "invalid", "error"];

export function classifyError(error: unknown): { status: DoctorStatus; note: string } {
  const err = error as { name?: unknown; message?: unknown } | null | undefined;
  const name = typeof err?.name === "string" ? err.name : "";
  const message = typeof err?.message === "string" ? err.message : String(error);
  const lower = message.toLowerCase();
  const note = message.split(/\r?\n/)[0].slice(0, NOTE_MAX);
  // bedrock-mantle errors are plain Errors that carry the HTTP status in the text.
  const http = /^bedrock-mantle error \((\d{3})\)/.exec(message)?.[1];

  let status: DoctorStatus = "error";
  if (
    name === "ThrottlingException" ||
    name === "ServiceQuotaExceededException" ||
    http === "429" ||
    lower.includes("too many tokens") ||
    lower.includes("too many requests")
  ) {
    status = "throttled";
  } else if (
    name === "AccessDeniedException" ||
    http === "401" ||
    http === "403" ||
    lower.includes("not authorized") ||
    lower.includes("access denied") ||
    lower.includes("don't have access")
  ) {
    status = "denied";
  } else if (
    // Only an unknown or unavailable id counts: a rejected parameter is an error.
    name === "ResourceNotFoundException" ||
    http === "404" ||
    lower.includes("model identifier is invalid") ||
    lower.includes("on-demand throughput isn")
  ) {
    status = "invalid";
  }
  return { status, note };
}

function emptyCounts(): Record<DoctorStatus, number> {
  return { ok: 0, throttled: 0, denied: 0, invalid: 0, error: 0 };
}

interface Target {
  alias: string;
  modelId: string;
  name: string;
  known: boolean;
}

function buildTargets(models?: string[]): Target[] {
  if (!models) {
    return TEXT_MODELS.map((m) => ({ alias: m.aliases[0] ?? m.id, modelId: m.id, name: m.name, known: true }));
  }
  // One probe per model: a repeated alias or id would be a second billed call.
  const seen = new Set<string>();
  const targets: Target[] = [];
  for (const input of models) {
    const modelId = resolveModelId(input);
    if (seen.has(modelId)) continue;
    seen.add(modelId);
    const info = getModelInfo(modelId);
    targets.push(
      info
        ? { alias: info.aliases[0] ?? info.id, modelId, name: info.name, known: true }
        : { alias: input, modelId, name: input, known: false },
    );
  }
  return targets;
}

async function probe(target: Target, ask: AskFn, signal?: AbortSignal): Promise<DoctorRow> {
  const base = { alias: target.alias, modelId: target.modelId, name: target.name };
  if (!target.known) {
    return { ...base, status: "invalid", latencyMs: 0, note: "not in the model registry" };
  }
  const start = Date.now();
  try {
    const result = await ask({ modelId: target.modelId, prompt: PROBE_PROMPT, maxTokens: 32, signal });
    const row: DoctorRow = { ...base, status: "ok", latencyMs: result.latencyMs ?? Date.now() - start };
    if (!result.text.trim()) row.note = "empty reply";
    return row;
  } catch (error) {
    const { status, note } = classifyError(error);
    return { ...base, status, latencyMs: Date.now() - start, note };
  }
}

export async function runDoctor(options: DoctorOptions = {}, ask: AskFn = converse): Promise<DoctorReport> {
  const started = Date.now();
  const targets = buildTargets(options.models);
  const wanted = Number.isFinite(options.concurrency) ? Math.floor(options.concurrency as number) : DEFAULT_CONCURRENCY;
  const limit = Math.min(8, Math.max(1, wanted));
  const slots: (DoctorRow | undefined)[] = new Array(targets.length).fill(undefined);
  let next = 0;

  async function worker(): Promise<void> {
    while (!options.signal?.aborted && next < targets.length) {
      const i = next++;
      slots[i] = await probe(targets[i], ask, options.signal);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));

  // Probes skipped by an abort leave no row; `skipped` says how many.
  const rows = slots.filter((r): r is DoctorRow => r !== undefined);
  const counts = emptyCounts();
  for (const row of rows) counts[row.status]++;
  const report: DoctorReport = { rows, counts, totalMs: Date.now() - started };
  if (rows.length < targets.length) report.skipped = targets.length - rows.length;
  return report;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    "| alias | model id | status | ms | note |",
    "| --- | --- | --- | --- | --- |",
    ...report.rows.map(
      (r) => `| ${cell(r.alias)} | ${cell(r.modelId)} | ${r.status} | ${r.latencyMs} | ${cell(r.note ?? "")} |`,
    ),
    "",
  ];
  const parts = STATUSES.filter((s) => report.counts[s] > 0).map((s) => `${report.counts[s]} ${s}`);
  const summary = parts.length ? parts.join(", ") : "0 ok";
  const cut = report.skipped ? ` (cancelled: ${report.skipped} not probed)` : "";
  lines.push(`${summary} of ${report.rows.length} models in ${(report.totalMs / 1000).toFixed(1)}s${cut}`);
  return lines.join("\n");
}
