import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost, formatCost, formatCostTotal, sumCosts } from "./cost.js";
import { MODEL_REGISTRY, TEXT_MODELS } from "./models.js";
import { TextModelSchema } from "./types.js";

// Run fn with a temporary price on the first registry entry, then restore it.
function withPrice(price: { input: number; output: number } | undefined, fn: (id: string) => void): void {
  const id = TEXT_MODELS[0].id;
  const entry = MODEL_REGISTRY[id];
  const saved = entry.price;
  try {
    entry.price = price;
    fn(id);
  } finally {
    entry.price = saved;
  }
}

test("estimateCost multiplies tokens by the per-1M price", () => {
  withPrice({ input: 3, output: 15 }, (id) => {
    assert.equal(estimateCost(id, 1_000_000, 500_000), 10.5);
  });
});

test("estimateCost is undefined for an unknown model", () => {
  assert.equal(estimateCost("no.such-model-v1:0", 100, 100), undefined);
});

test("estimateCost is undefined for a model with no price", () => {
  withPrice(undefined, (id) => {
    assert.equal(estimateCost(id, 100, 100), undefined);
  });
});

test("estimateCost treats one missing count as 0 and both missing as undefined", () => {
  withPrice({ input: 3, output: 15 }, (id) => {
    assert.equal(estimateCost(id, 1_000_000, undefined), 3);
    assert.equal(estimateCost(id, undefined, 1_000_000), 15);
    assert.equal(estimateCost(id, undefined, undefined), undefined);
    // No usage reported arrives as 0 and 0: unknown, not free.
    assert.equal(estimateCost(id, 0, 0), undefined);
  });
});

test("formatCost picks decimals by range", () => {
  assert.equal(formatCost(undefined), "");
  assert.equal(formatCost(0), "~$0.0000");
  assert.equal(formatCost(0.00003), "<$0.0001");
  assert.equal(formatCost(0.00031), "~$0.0003");
  assert.equal(formatCost(0.042), "~$0.042");
  assert.equal(formatCost(1.25), "~$1.25");
});

test("sumCosts and formatCostTotal cover all, some and none priced", () => {
  const all = sumCosts([0.02, 0.022]);
  assert.equal(all.priced, 2);
  assert.equal(all.count, 2);
  assert.equal(formatCostTotal(all), "~$0.042");

  const some = sumCosts([0.02, undefined, 0.022]);
  assert.equal(some.priced, 2);
  assert.equal(some.count, 3);
  assert.equal(formatCostTotal(some), "~$0.042 (2 of 3 calls priced)");

  const none = sumCosts([undefined, undefined]);
  assert.equal(none.usd, 0);
  assert.equal(formatCostTotal(none), "");
});

test("TextModelSchema accepts a price and rejects a negative one", () => {
  const base = { ...TEXT_MODELS[0] };
  assert.ok(TextModelSchema.safeParse({ ...base, price: { input: 3, output: 15 } }).success);
  assert.ok(!TextModelSchema.safeParse({ ...base, price: { input: -1, output: 15 } }).success);
});
