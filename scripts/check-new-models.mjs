#!/usr/bin/env node
// Lists AWS Bedrock model cards that the catalog neither has nor has deliberately
// skipped. Needs no AWS credentials, so it runs weekly in CI
// (.github/workflows/lifecycle.yml, job new-models) and opens or updates one issue.
//
//   node scripts/check-new-models.mjs                 one line per new card
//   node scripts/check-new-models.mjs --json          { "checked": n, "new": [...] } only
//   node scripts/check-new-models.mjs --registry-dir <path>   check a modified copy of src/data
//   node scripts/check-new-models.mjs --write-baseline        add every unmatched card to
//                                                             scripts/model-skips.json
//
// Exit code: 0 whether or not there are new cards; 2 when the index, or more than
// 10 percent of the cards, could not be fetched (so a network problem never looks
// like "no new models").

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const BASE = "https://docs.aws.amazon.com/bedrock/latest/userguide/";
const INDEX = `${BASE}model-cards.md`;
const CONCURRENCY = 8;
const TIMEOUT_MS = 20_000;
const BASELINE_REASON = "baseline 2026-11-20: not in the catalog when the watcher was added";

const args = process.argv.slice(2);
const json = args.includes("--json");
const writeBaseline = args.includes("--write-baseline");
const dirFlag = args.indexOf("--registry-dir");
const dataDir = dirFlag >= 0 ? resolve(args[dirFlag + 1] ?? "") + "/" : fileURLToPath(new URL("../src/data/", import.meta.url));
const skipsPath = fileURLToPath(new URL("./model-skips.json", import.meta.url));

const PROFILE = /^(us|eu|apac|jp|au|global)\./;
const baseId = (id) => id.replace(PROFILE, "");
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function fail(message) {
  console.error(message);
  process.exit(2);
}

async function fetchText(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`${url}: ${last.message}`);
}

// The model ids a card lists in its "Programmatic Access" (or "Call the model")
// section only: ids mentioned elsewhere on the page can belong to older models.
function cardIds(page) {
  const lines = page.split("\n");
  const start = lines.findIndex((l) => /^##\s+(programmatic access|call the model)/i.test(l));
  if (start < 0) return [];
  const ids = new Set();
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.trim().startsWith("|")) continue;
    for (const cell of line.split("|")) {
      for (const token of cell.replace(/`/g, "").split(/[\s,]+/)) {
        if (/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._:-]*$/.test(token) && !token.endsWith(".")) ids.add(token);
      }
    }
  }
  return [...ids];
}

const registry = readdirSync(dataDir)
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => JSON.parse(readFileSync(dataDir + f, "utf-8")));
const knownIds = new Set(registry.map((m) => baseId(m.id)));
const knownNames = new Set(registry.map((m) => norm(m.name ?? "")).filter(Boolean));

let skipsFile = { note: "", skips: [] };
try {
  skipsFile = JSON.parse(readFileSync(skipsPath, "utf-8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const skipSlugs = new Set(skipsFile.skips.map((s) => s.card).filter(Boolean));
const skipIds = new Set(skipsFile.skips.flatMap((s) => s.ids ?? []).map(baseId));
const skipNames = new Set(skipsFile.skips.map((s) => norm(s.name ?? "")).filter(Boolean));

let index;
try {
  index = await fetchText(INDEX);
} catch (error) {
  fail(`Could not fetch the model card index: ${error.message}`);
}
const slugs = [...new Set([...index.matchAll(/\]\((model-card-[a-z0-9-]+)\.md\)/g)].map((m) => m[1]))];
if (slugs.length === 0) fail(`No model card links found on ${INDEX}; the page format changed, update this parser.`);

const cards = [];
const failures = [];
let next = 0;
async function worker() {
  while (next < slugs.length) {
    const slug = slugs[next++];
    try {
      const page = await fetchText(`${BASE}${slug}.md`);
      const name = page.match(/^#\s+(.+)$/m)?.[1].trim() ?? slug;
      cards.push({ slug, name, ids: cardIds(page), url: `${BASE}${slug}.html` });
    } catch (error) {
      failures.push(error.message);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (failures.length > slugs.length * 0.1) {
  fail(`${failures.length} of ${slugs.length} model cards failed to fetch, e.g. ${failures[0]}`);
}
cards.sort((a, b) => a.slug.localeCompare(b.slug));

let inCatalog = 0;
let skipped = 0;
const fresh = [];
for (const card of cards) {
  const known = card.ids.length > 0 ? card.ids.some((id) => knownIds.has(baseId(id))) : knownNames.has(norm(card.name));
  if (known) inCatalog++;
  else if (skipSlugs.has(card.slug) || card.ids.some((id) => skipIds.has(baseId(id))) || skipNames.has(norm(card.name))) skipped++;
  else fresh.push(card);
}

if (writeBaseline) {
  for (const card of fresh) {
    skipsFile.skips.push({ card: card.slug, name: card.name, ids: card.ids, reason: BASELINE_REASON });
  }
  skipsFile.skips.sort((a, b) => a.card.localeCompare(b.card));
  writeFileSync(skipsPath, JSON.stringify(skipsFile, null, 2) + "\n");
  console.error(`Wrote ${fresh.length} baseline skip(s) to ${skipsPath}`);
  process.exit(0);
}

if (json) {
  console.log(JSON.stringify({ checked: cards.length, new: fresh.map(({ name, ids, url }) => ({ name, ids, url })) }, null, 2));
} else {
  for (const card of fresh) console.log(`${card.name} (${card.ids.join(", ") || "no id listed"}) ${card.url}`);
  console.log(`${fresh.length} new model card(s); ${cards.length} cards checked, ${inCatalog} in the catalog, ${skipped} skipped`);
}
