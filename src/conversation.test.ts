import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationStore, conversationHelp } from "./conversation.js";

function setup(options: ConstructorParameters<typeof ConversationStore>[0] = {}) {
  const clock = { t: 1000 };
  const store = new ConversationStore({ ...options, now: () => clock.t });
  return { clock, store };
}

const turn = (n: number, reply = `reply ${n}`) => ({ prompt: `prompt ${n}`, reply, modelId: "some-model" });

test("turns appear in order and are copies", () => {
  const { store } = setup();
  store.append("a", turn(1));
  store.append("a", turn(2));
  const turns = store.turns("a");
  assert.deepEqual(turns.map((t) => t.prompt), ["prompt 1", "prompt 2"]);
  turns[0].prompt = "changed";
  assert.equal(store.turns("a")[0].prompt, "prompt 1");
  assert.deepEqual(store.turns("unknown"), []);
});

test("expires after ttl and an append resets it", () => {
  const { clock, store } = setup({ ttlMs: 100 });
  store.append("a", turn(1));
  clock.t += 99;
  assert.equal(store.turns("a").length, 1);
  store.append("a", turn(2));
  clock.t += 99;
  assert.equal(store.turns("a").length, 2);
  clock.t += 1;
  assert.deepEqual(store.turns("a"), []);
  assert.equal(store.size(), 0);
});

test("maxTurns drops the oldest", () => {
  const { store } = setup({ maxTurns: 3 });
  for (let i = 1; i <= 5; i++) store.append("a", turn(i));
  assert.deepEqual(store.turns("a").map((t) => t.prompt), ["prompt 3", "prompt 4", "prompt 5"]);
});

test("maxChars drops the oldest", () => {
  const { store } = setup({ maxChars: 30 });
  store.append("a", { prompt: "p1", reply: "x".repeat(10), modelId: "m" });
  store.append("a", { prompt: "p2", reply: "y".repeat(10), modelId: "m" });
  store.append("a", { prompt: "p3", reply: "z".repeat(10), modelId: "m" });
  assert.deepEqual(store.turns("a").map((t) => t.prompt), ["p2", "p3"]);
});

test("a turn larger than maxChars on its own is skipped and earlier turns stay", () => {
  const { store } = setup({ maxChars: 30 });
  assert.equal(store.append("a", { prompt: "p1", reply: "ok", modelId: "m" }), true);
  assert.equal(store.append("a", { prompt: "p2", reply: "x".repeat(40), modelId: "m" }), false);
  assert.deepEqual(store.turns("a").map((t) => t.prompt), ["p1"]);
});

test("the 51st conversation evicts the least recently used", () => {
  const { clock, store } = setup();
  for (let i = 0; i < 50; i++) {
    clock.t += 1;
    store.append(`c${i}`, turn(i));
  }
  clock.t += 1;
  store.append("c0", turn(99));
  clock.t += 1;
  store.append("c50", turn(50));
  assert.equal(store.size(), 50);
  assert.equal(store.turns("c1").length, 0);
  assert.equal(store.turns("c0").length, 2);
  assert.equal(store.turns("c50").length, 1);
});

test("invalid ids are rejected", () => {
  const { store } = setup();
  for (const id of ["", "x".repeat(65), "a/b", "a b"]) {
    assert.throws(() => store.append(id, turn(1)), /letters, digits/);
  }
  store.append("x".repeat(64), turn(1));
  assert.equal(store.size(), 1);
});

test("buildPrompt returns the prompt unchanged with no turns", () => {
  const { store } = setup();
  assert.equal(store.buildPrompt("a", "hello"), "hello");
});

test("buildPrompt includes earlier turns in order, then the new prompt", () => {
  const { store } = setup();
  store.append("a", turn(1));
  store.append("a", turn(2));
  const out = store.buildPrompt("a", "new question");
  const order = ["prompt 1", "reply 1", "prompt 2", "reply 2", "new question"].map((s) => out.indexOf(s));
  assert.ok(order.every((i) => i >= 0));
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  assert.match(out, /User:/);
  assert.match(out, /Assistant \(some-model\):/);
});

test("an empty reply is not stored", () => {
  const { store } = setup();
  store.append("a", turn(1, "   "));
  assert.equal(store.size(), 0);
  assert.deepEqual(store.turns("a"), []);
});

test("clear and size", () => {
  const { store } = setup();
  store.append("a", turn(1));
  store.append("b", turn(2));
  assert.equal(store.size(), 2);
  assert.equal(store.clear("a"), true);
  assert.equal(store.clear("a"), false);
  assert.equal(store.size(), 1);
});

test("conversationHelp states the limits", () => {
  const help = conversationHelp();
  assert.match(help, /30 minutes/);
  assert.match(help, /20 turns/);
});
