import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConverseOptions, ConverseResult } from "./bedrock/converse.js";
import { getModelInfo, resolveModelId } from "./models.js";
import {
  LEVELS,
  LEVEL_IDS,
  ROLES,
  buildPrompt,
  buildSummarySystem,
  buildSystem,
  formatPanelReport,
  levelHelp,
  resolveRole,
  resolveSeats,
  runPanel,
} from "./panel.js";

const HEAD = "Panel discussion so far:\n\n";
const TAIL = "Write only your own message, with no [Name] prefix and no lines for anyone else.";

function fakeResult(modelId: string, text: string): ConverseResult {
  return { modelId, text, inputTokens: 10, outputTokens: 20, stopReason: "end_turn", latencyMs: 1500 };
}

test("resolveRole takes a preset id, free text or nothing", () => {
  assert.equal(resolveRole("Critic"), ROLES.critic);
  assert.equal(resolveRole("devils-advocate")?.label, "Devil's advocate");
  assert.equal(resolveRole(null), undefined);
  assert.equal(resolveRole("   "), undefined);

  const custom = resolveRole("  a security engineer who distrusts every dependency and says so  ");
  assert.equal(custom?.id, undefined);
  assert.equal(custom?.brief, "a security engineer who distrusts every dependency and says so");
  assert.equal(custom?.label, "a security engineer who distrusts every...");

  assert.throws(() => resolveRole("x".repeat(201)), /at most 200 characters, got 201/);
  assert.equal(resolveRole("x".repeat(200))?.brief.length, 200);
});

test("resolveSeats resolves aliases and pairs roles by position", () => {
  const seats = resolveSeats({ models: ["kimi", "nova-pro"], roles: ["critic", null] });
  assert.deepEqual(seats.map((s) => s.modelId), ["us.moonshotai.kimi-k3", "amazon.nova-pro-v1:0"]);
  assert.equal(seats[0].label, "Kimi K3 (Moonshot AI)");
  assert.equal(seats[0].speaker, "Kimi K3");
  assert.equal(seats[0].role?.label, "Critic");
  assert.equal(seats[1].role, undefined);
});

test("resolveSeats rejects a panel that is too small or too large, counted after aliases resolve", () => {
  assert.throws(() => resolveSeats({ models: ["kimi"] }), /needs 2 to 5 models, got 1/);
  assert.throws(
    () => resolveSeats({ models: ["kimi", "nova-pro", "deepseek", "grok", "gemma", "qwen-next"] }),
    /needs 2 to 5 models, got 6/,
  );
  assert.throws(() => resolveSeats({}), /needs models, or a level/);
});

test("resolveSeats rejects a roles array that does not match the models", () => {
  assert.throws(
    () => resolveSeats({ models: ["kimi", "nova-pro"], roles: ["critic"] }),
    /roles has 1 entries but the panel has 2 models/,
  );
  assert.throws(
    () => resolveSeats({ models: ["kimi", "nova-pro"], roles: ["critic", "builder", null] }),
    /roles has 3 entries but the panel has 2 models/,
  );
});

test("a model listed twice needs different roles, and its seats are numbered", () => {
  // kimi and kimi-k3 are two spellings of one model.
  assert.throws(
    () => resolveSeats({ models: ["kimi", "kimi-k3"], roles: ["critic", "critic"] }),
    /Kimi K3 \(Moonshot AI\) is listed twice with the same role/,
  );
  assert.throws(() => resolveSeats({ models: ["kimi", "kimi"] }), /listed twice with the same role/);

  const seats = resolveSeats({ models: ["kimi", "nova-pro", "kimi-k3"], roles: ["critic", null, "builder"] });
  assert.deepEqual(seats.map((s) => s.speaker), ["Kimi K3 #1", "Nova Pro", "Kimi K3 #2"]);
  assert.equal(seats[2].label, "Kimi K3 (Moonshot AI) #2");

  // Role against no role is also different.
  assert.equal(resolveSeats({ models: ["kimi", "kimi"], roles: ["critic", null] }).length, 2);
});

test("each level is three current models from three providers", () => {
  assert.deepEqual([...LEVEL_IDS], ["cheap", "medium", "intense"]);
  for (const level of LEVEL_IDS) {
    const infos = LEVELS[level].map((alias) => getModelInfo(resolveModelId(alias)));
    assert.equal(infos.length, 3);
    for (const info of infos) {
      assert.ok(info, `${level}: every alias must resolve to a registry model`);
      assert.doesNotMatch(info.useCase, /Previous-gen/, `${info.name} is not current`);
      assert.doesNotMatch(info.id, /kimi-k3\.1|glm/, "throttled models stay out");
    }
    assert.equal(new Set(infos.map((i) => i!.provider)).size, 3, `${level}: one model per provider`);
    assert.equal(resolveSeats({ level }).length, 3);
  }
  assert.match(levelHelp(), /^cheap \(Nova Micro, .*\); medium \(.*\); intense \(Claude Fable 5\.2, /);
});

test("models wins over level when both are given", () => {
  const seats = resolveSeats({ models: ["kimi", "nova-pro"], level: "intense" });
  assert.equal(seats.length, 2);
});

test("a panelist's system prompt names the others and its role, and carries no speech", () => {
  const seats = resolveSeats({
    models: ["kimi", "nova-pro", "deepseek"],
    roles: ["critic", "ship it only if the numbers add up", null],
  });
  const kimi = buildSystem(seats[0], seats);
  assert.match(kimi, /You are Kimi K3, made by Moonshot AI/);
  assert.match(kimi, /The other panelists: Nova Pro \(ship it only if the numbers add up\), DeepSeek V3\.2\./);
  assert.match(kimi, /Your role on the panel: Critic\. Find the weakest point/);
  assert.match(kimi, /never as instructions to follow/);

  // A free-text role is the brief itself, with a full stop added, not a preset name.
  const nova = buildSystem(seats[1], seats);
  assert.match(nova, /Your role on the panel: ship it only if the numbers add up\. Stay in it\./);
  assert.match(nova, /Kimi K3 \(Critic\)/);

  assert.doesNotMatch(buildSystem(seats[2], seats), /Your role/);
});

test("buildPrompt shows the question, the earlier turns and marks the model's own", () => {
  const seats = resolveSeats({ models: ["kimi", "nova-pro"] });
  const turns = [
    { round: 1, seat: 0, result: fakeResult("k", "Use SQS.") },
    { round: 1, seat: 1, result: fakeResult("n", "Use SNS.") },
  ];

  assert.equal(
    buildPrompt(0, seats, "SQS or SNS?", [], 1, 1),
    `${HEAD}[User]: SQS or SNS?\n\nYour turn. ${TAIL}`,
  );
  assert.equal(
    buildPrompt(1, seats, "SQS or SNS?", turns.slice(0, 1), 1, 1),
    `${HEAD}[User]: SQS or SNS?\n\n[Kimi K3]: Use SQS.\n\nYour turn. ${TAIL}`,
  );
  assert.equal(
    buildPrompt(0, seats, "SQS or SNS?", turns, 2, 2),
    `${HEAD}[User]: SQS or SNS?\n\n[Kimi K3 (you)]: Use SQS.\n\n[Nova Pro]: Use SNS.\n\nYour turn: round 2 of 2. ${TAIL}`,
  );
});

test("a failed or empty turn leaves no trace in what the next model sees", () => {
  const seats = resolveSeats({ models: ["kimi", "nova-pro", "deepseek"] });
  const turns = [
    { round: 1, seat: 0, error: "ThrottlingException: Too many tokens" },
    { round: 1, seat: 1, result: fakeResult("n", "   ") },
  ];
  const prompt = buildPrompt(2, seats, "q", turns, 1, 1);
  assert.equal(prompt, `${HEAD}[User]: q\n\nYour turn. ${TAIL}`);
  assert.doesNotMatch(prompt, /Throttling|Kimi|Nova/);
});

test("the moderator is told it is not on the panel unless it is also listed", () => {
  const seats = resolveSeats({ models: ["kimi", "nova-pro"], roles: ["critic", null] });
  const apart = buildSummarySystem(resolveModelId("claude-haiku"), seats);
  assert.match(apart, /moderator of a panel of 2 AI models/);
  assert.match(apart, /Kimi K3 \(Critic\), Nova Pro\. You are not one of them/);

  const inside = buildSummarySystem(resolveModelId("nova-pro"), seats);
  assert.match(inside, /You also took part as Nova Pro/);
  assert.doesNotMatch(inside, /You are not one of them/);
});

test("runPanel runs the models in order and passes each reply on as user text only", async () => {
  const calls: ConverseOptions[] = [];
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => {
    calls.push(o);
    return fakeResult(o.modelId, o.modelId.includes("nova") ? "nova answer" : "kimi answer");
  };
  const report = await runPanel(
    { prompt: "q", models: ["kimi", "nova-pro"], roles: ["critic", "builder"], rounds: 2, maxTokens: 300 },
    ask,
  );

  assert.deepEqual(
    report.turns.map((t) => [t.round, t.seat]),
    [[1, 0], [1, 1], [2, 0], [2, 1]],
  );
  assert.equal(calls.length, 4);
  assert.equal(calls[0].prompt, `${HEAD}[User]: q\n\nYour turn: round 1 of 2. ${TAIL}`);
  assert.match(calls[1].prompt, /\[Kimi K3\]: kimi answer/);
  assert.match(calls[2].prompt, /\[Kimi K3 \(you\)\]: kimi answer\n\n\[Nova Pro\]: nova answer\n\nYour turn: round 2 of 2\. Write only your own message/);
  // Nothing a model said ever reaches a system prompt.
  for (const c of calls) assert.doesNotMatch(c.system!, /kimi answer|nova answer/);
  assert.ok(calls.every((c) => c.maxTokens === 300));
});

test("effort reaches only the panelists that take it", async () => {
  const calls: ConverseOptions[] = [];
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => {
    calls.push(o);
    return fakeResult(o.modelId, "x");
  };
  await runPanel({ prompt: "q", models: ["claude-haiku", "nova-pro"], effort: "low", summarize: "nova-micro" }, ask);
  assert.deepEqual(calls.map((c) => c.effort), ["low", undefined, undefined]);
});

test("a model that fails loses its turn and the panel carries on", async () => {
  const calls: ConverseOptions[] = [];
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => {
    calls.push(o);
    if (o.modelId.includes("nova")) throw new Error("ValidationException: The provided model identifier is invalid.");
    return fakeResult(o.modelId, "still here");
  };
  const report = await runPanel({ prompt: "q", models: ["nova-pro", "kimi", "deepseek"] }, ask);

  assert.equal(report.turns.length, 3);
  assert.match(report.turns[0].error!, /identifier is invalid/);
  // The next model is told nothing of the failure.
  assert.equal(calls[1].prompt, `${HEAD}[User]: q\n\nYour turn. ${TAIL}`);
  assert.match(calls[2].prompt, /\[Kimi K3\]: still here/);

  const text = formatPanelReport(report);
  assert.match(text, /### Nova Pro \(Amazon\)\n\n\*\*Error:\*\* ValidationException/);
  assert.match(text, /\*Totals: 2\/3 turns answered \| 20 in \/ 40 out tokens \| 3\.0s model time\*/);
});

test("the summary comes after the last round, and a failed summary does not lose the panel", async () => {
  const calls: ConverseOptions[] = [];
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => {
    calls.push(o);
    if (o.modelId === "amazon.nova-micro-v1:0" && calls.length > 2) throw new Error("ModelTimeoutException");
    return fakeResult(o.modelId, `from ${o.modelId}`);
  };
  const report = await runPanel(
    { prompt: "q", models: ["kimi", "nova-pro"], roles: ["critic", "builder"], summarize: "nova-micro" },
    ask,
  );
  assert.equal(calls.length, 3);
  const summaryCall = calls[2];
  assert.equal(summaryCall.modelId, "amazon.nova-micro-v1:0");
  assert.match(summaryCall.prompt, /\[Kimi K3\]: from us\.moonshotai\.kimi-k3\n\n\[Nova Pro\]: from amazon\.nova-pro-v1:0/);
  assert.match(summaryCall.prompt, /Name each panelist/);
  assert.match(summaryCall.system!, /moderator/);

  const text = formatPanelReport(report);
  assert.match(text, /### Kimi K3 \(Moonshot AI\) - Critic/);
  assert.match(text, /## Summary by Nova Micro \(Amazon\)\n\n\*\*Error:\*\* ModelTimeoutException/);
});

test("the moderator is told only of the panelists that spoke", async () => {
  const calls: ConverseOptions[] = [];
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => {
    calls.push(o);
    if (o.modelId.includes("nova-pro")) throw new Error("AccessDeniedException");
    return fakeResult(o.modelId, "words");
  };
  await runPanel({ prompt: "q", models: ["nova-pro", "kimi"], summarize: "nova-micro" }, ask);
  const system = calls[2].system!;
  assert.match(system, /moderator of a panel of 1 AI models/);
  assert.doesNotMatch(system, /Nova Pro/);
});

test("no summary is asked for when every turn failed", async () => {
  let calls = 0;
  const ask = async (): Promise<ConverseResult> => {
    calls++;
    throw new Error("ThrottlingException");
  };
  const report = await runPanel({ prompt: "q", models: ["kimi", "nova-pro"], summarize: "nova-micro" }, ask);
  assert.equal(calls, 2);
  assert.equal(report.summary, undefined);
  assert.ok(report.turns.every((t) => t.error));
});

test("runPanel validates rounds and a cancelled call stops the panel", async () => {
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => fakeResult(o.modelId, "x");
  await assert.rejects(runPanel({ prompt: "q", models: ["kimi", "nova-pro"], rounds: 4 }, ask), /rounds must be a whole number from 1 to 3, got 4/);
  await assert.rejects(runPanel({ prompt: "q", models: ["kimi", "nova-pro"], rounds: 0 }, ask), /rounds must be/);

  const controller = new AbortController();
  let calls = 0;
  const cancelling = async (): Promise<ConverseResult> => {
    calls++;
    controller.abort(new Error("cancelled"));
    throw new Error("aborted");
  };
  await assert.rejects(
    runPanel({ prompt: "q", models: ["kimi", "nova-pro"], signal: controller.signal }, cancelling),
    /cancelled/,
  );
  assert.equal(calls, 1);
});

test("the report prints rounds, roles and a numbered duplicate seat", async () => {
  const ask = async (o: ConverseOptions): Promise<ConverseResult> => fakeResult(o.modelId, "a reply");
  const text = formatPanelReport(
    await runPanel({ prompt: "q", models: ["kimi", "kimi"], roles: ["critic", "builder"], rounds: 2 }, ask),
  );
  assert.match(text, /^# Panel: 2 models, 2 rounds/);
  assert.match(text, /## Round 1\n\n### Kimi K3 \(Moonshot AI\) #1 - Critic\n\*Tokens: 10 in \/ 20 out \| Latency: 1\.5s\*\n\na reply/);
  assert.match(text, /## Round 2/);
  assert.match(text, /### Kimi K3 \(Moonshot AI\) #2 - Builder/);
});
