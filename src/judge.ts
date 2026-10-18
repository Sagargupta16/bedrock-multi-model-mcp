import { z } from "zod";
import { converse, type ConverseOptions, type ConverseResult } from "./bedrock/converse.js";
import { getModelInfo, resolveModelId } from "./models.js";

// bedrock_judge: N candidate models answer the same prompt, then a judge model
// scores the answers and picks a winner (and, on request, merges them into one
// final answer). Candidates are shown to the judge as "Answer A/B/C" in a
// shuffled order, so the judge sees neither model names nor a fixed position,
// which are the two biases LLM judges are best known for.

export const DEFAULT_JUDGE = "claude-opus";
const LABELS = ["A", "B", "C", "D", "E"];

export interface Candidate {
  label: string;
  modelId: string;
  name: string;
  result?: ConverseResult;
  error?: string;
}

export interface Verdict {
  scores: Record<string, number>;
  winner: string;
  reasoning: string;
  finalAnswer?: string;
}

const VerdictSchema = z.object({
  scores: z.record(z.string(), z.number()),
  winner: z.string(),
  reasoning: z.string(),
  final_answer: z.string().optional(),
});

function modelLabel(modelId: string): string {
  const info = getModelInfo(modelId);
  return info ? `${info.name} (${info.provider})` : modelId;
}

// Fisher-Yates shuffle of the model list, then labels A.. in shuffled order.
// `random` is injectable so tests get a fixed order.
export function assignLabels(models: string[], random: () => number = Math.random): Candidate[] {
  const order = [...models];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((m, i) => {
    const modelId = resolveModelId(m);
    return { label: LABELS[i], modelId, name: modelLabel(modelId) };
  });
}

export function buildJudgePrompt(
  question: string,
  answers: { label: string; text: string }[],
  options: { criteria?: string; synthesize?: boolean } = {},
): string {
  const criteria =
    options.criteria ?? "correctness, completeness, clarity and concision";
  const labels = answers.map((a) => a.label);
  const scoreShape = labels.map((l) => `"${l}": <1-10>`).join(", ");
  const finalField = options.synthesize
    ? `,\n  "final_answer": "<one answer that keeps the best parts of all answers and fixes their mistakes>"`
    : "";

  return [
    `You are judging ${answers.length} anonymous answers to the same question.`,
    `Score each answer from 1 to 10 on: ${criteria}.`,
    "Judge the content only. Ignore length unless it hurts clarity, and do not favor an answer for its position.",
    "",
    "<question>",
    question,
    "</question>",
    "",
    ...answers.flatMap((a) => [`<answer label="${a.label}">`, a.text, "</answer>", ""]),
    "Reply with a single JSON object and nothing else, in this shape:",
    "{",
    `  "scores": { ${scoreShape} },`,
    `  "winner": "<label of the best answer>",`,
    `  "reasoning": "<2-4 sentences on why the winner beat the others>"${finalField}`,
    "}",
  ].join("\n");
}

// Pulls the first {...} block out of the judge's reply (models often wrap JSON
// in a code fence or a sentence) and validates it. Returns undefined when the
// reply is not usable, so the caller can show the raw text instead.
export function parseVerdict(text: string, labels: string[]): Verdict | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  const parsed = VerdictSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const winner = parsed.data.winner.trim().toUpperCase();
  if (!labels.includes(winner)) return undefined;
  // Judges sometimes echo labels in lower case ("a": 9); match the winner's casing.
  const scores = Object.fromEntries(
    Object.entries(parsed.data.scores).map(([label, score]) => [label.trim().toUpperCase(), score]),
  );
  return {
    scores,
    winner,
    reasoning: parsed.data.reasoning,
    finalAnswer: parsed.data.final_answer,
  };
}

export interface JudgeOptions {
  models: string[];
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  judge?: string;
  criteria?: string;
  synthesize?: boolean;
}

export interface JudgeReport {
  judgeId: string;
  candidates: Candidate[];
  verdict?: Verdict;
  rawJudgeText?: string;
  judgeResult?: ConverseResult;
  // Set when the judge call itself failed; the candidate answers still return.
  judgeError?: string;
}

export async function runJudge(
  options: JudgeOptions,
  ask: (o: ConverseOptions) => Promise<ConverseResult> = converse,
  random: () => number = Math.random,
): Promise<JudgeReport> {
  const candidates = assignLabels(options.models, random);
  const judgeId = resolveModelId(options.judge ?? DEFAULT_JUDGE);

  const settled = await Promise.allSettled(
    candidates.map((c) =>
      ask({
        modelId: c.modelId,
        prompt: options.prompt,
        system: options.system,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      }),
    ),
  );
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") candidates[i].result = s.value;
    else candidates[i].error = s.reason instanceof Error ? s.reason.message : String(s.reason);
  });

  const answered = candidates.filter((c) => c.result);
  if (answered.length === 0) {
    const reasons = candidates.map((c) => `${c.name}: ${c.error}`).join("; ");
    throw new Error(`No candidate model answered. ${reasons}`);
  }
  // One answer leaves nothing to compare; return it without a judge call.
  if (answered.length === 1) return { judgeId, candidates };

  const judgePrompt = buildJudgePrompt(
    options.prompt,
    answered.map((c) => ({ label: c.label, text: c.result!.text })),
    { criteria: options.criteria, synthesize: options.synthesize },
  );
  let judgeResult: ConverseResult;
  try {
    judgeResult = await ask({ modelId: judgeId, prompt: judgePrompt, temperature: 0 });
  } catch (err) {
    return {
      judgeId,
      candidates,
      judgeError: err instanceof Error ? err.message : String(err),
    };
  }
  const verdict = parseVerdict(
    judgeResult.text,
    answered.map((c) => c.label),
  );
  return {
    judgeId,
    candidates,
    verdict,
    rawJudgeText: verdict ? undefined : judgeResult.text,
    judgeResult,
  };
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatJudgeReport(report: JudgeReport): string {
  const { candidates, verdict, judgeResult } = report;
  const judgeName = modelLabel(report.judgeId);
  const byLabel = new Map(candidates.map((c) => [c.label, c]));
  const out: string[] = [];

  if (report.judgeError) {
    out.push(`## Judge ${judgeName} failed`, "", `**Error:** ${report.judgeError}`);
  } else if (!judgeResult) {
    const only = candidates.find((c) => c.result)!;
    out.push(
      `## Only ${only.name} answered, so there was nothing to judge`,
      "",
      only.result!.text,
    );
  } else if (verdict) {
    const winner = byLabel.get(verdict.winner)!;
    out.push(`## Winner: ${winner.name}`, `*Judged blind by ${judgeName}*`, "");
    // Ties on score put the judge's winner first, so Rank 1 always matches the header.
    const isWinner = (c: Candidate) => (c.label === verdict.winner ? 1 : 0);
    const ranked = candidates
      .filter((c) => c.result)
      .sort(
        (a, b) =>
          (verdict.scores[b.label] ?? 0) - (verdict.scores[a.label] ?? 0) || isWinner(b) - isWinner(a),
      );
    out.push("| Rank | Model | Score | Tokens out | Latency |", "| --- | --- | --- | --- | --- |");
    ranked.forEach((c, i) => {
      const score = verdict.scores[c.label];
      out.push(
        `| ${i + 1} | ${c.name} | ${score === undefined ? "-" : `${score}/10`} | ` +
          `${c.result!.outputTokens} | ${seconds(c.result!.latencyMs)} |`,
      );
    });
    out.push("", `**Why:** ${verdict.reasoning}`);
    if (verdict.finalAnswer) out.push("", "## Merged answer", "", verdict.finalAnswer);
  } else {
    out.push(
      `## ${judgeName} did not return a parsable verdict`,
      "",
      "Answer labels: " + candidates.filter((c) => c.result).map((c) => `${c.label} = ${c.name}`).join(", "),
      "",
      report.rawJudgeText ?? "",
    );
  }

  const failed = candidates.filter((c) => c.error);
  if (failed.length > 0) {
    out.push("", "**Failed:** " + failed.map((c) => `${c.name} - ${c.error}`).join("; "));
  }

  if (judgeResult || report.judgeError) {
    if (judgeResult) {
      out.push(
        "",
        `*Judge: ${judgeResult.inputTokens} in / ${judgeResult.outputTokens} out | ${seconds(judgeResult.latencyMs)}*`,
      );
    }
    for (const c of candidates.filter((x) => x.result)) {
      out.push("", "---", "", `### Answer ${c.label}: ${c.name}`, "", c.result!.text);
    }
  }
  return out.join("\n");
}
