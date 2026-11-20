import { getModelInfo } from "./models.js";

export interface CostTotal {
  usd: number;
  priced: number;
  count: number;
}

// USD estimate from the registry price (per 1M tokens). undefined when the model is
// unknown, has no price, or there is no usage to price: converse() reports a
// missing usage block as 0 tokens, and that is an unknown cost, not a free call.
export function estimateCost(
  modelId: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number | undefined {
  const price = getModelInfo(modelId)?.price;
  if (!price) return undefined;
  if (!inputTokens && !outputTokens) return undefined;
  return ((inputTokens ?? 0) * price.input + (outputTokens ?? 0) * price.output) / 1_000_000;
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return "";
  // A small call on a cheap model costs a few thousandths of a cent; printing
  // that as ~$0.0000 would read as free.
  if (usd > 0 && usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `~$${usd.toFixed(4)}`;
  return usd >= 1 ? `~$${usd.toFixed(2)}` : `~$${usd.toFixed(3)}`;
}

export function sumCosts(costs: Array<number | undefined>): CostTotal {
  let usd = 0;
  let priced = 0;
  for (const cost of costs) {
    if (cost === undefined) continue;
    usd += cost;
    priced += 1;
  }
  return { usd, priced, count: costs.length };
}

export function formatCostTotal(total: CostTotal): string {
  if (total.priced === 0) return "";
  const text = formatCost(total.usd);
  return total.priced === total.count ? text : `${text} (${total.priced} of ${total.count} calls priced)`;
}
