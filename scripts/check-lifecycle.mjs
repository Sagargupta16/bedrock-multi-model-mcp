#!/usr/bin/env node
// Fails when a registry model is listed as Legacy or end-of-life on AWS's public
// model lifecycle page. Needs no AWS credentials, so it runs in CI on a weekly
// schedule (.github/workflows/lifecycle.yml) and on registry changes.
//
//   node scripts/check-lifecycle.mjs
//
// AWS: "New customers can't use Legacy models and existing customers may lose
// access to Legacy models after 15 days of inactivity." So a Legacy entry is
// already broken for new users, months before its EOL date.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE = "https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle-legacy.md";
const dataDir = fileURLToPath(new URL("../src/data/", import.meta.url));

// Registry ids may carry a cross-region inference profile prefix; the page
// lists base model ids.
const PROFILE = /^(us|eu|apac|jp|au|ca|in|us-gov|global)\./;
const baseId = (id) => id.replace(PROFILE, "");

const registry = readdirSync(dataDir)
  .filter((f) => f.endsWith(".json"))
  .flatMap((f) => JSON.parse(readFileSync(dataDir + f, "utf-8")).map((m) => ({ file: f, id: m.id, name: m.name })));

const response = await fetch(PAGE);
if (!response.ok) throw new Error(`${PAGE} returned HTTP ${response.status}`);
const page = await response.text();

// Each listing is a block of "- **Model name:** ...", "- **Model ID:** ...",
// "- **Legacy date:** ...", "- **EOL date:** ..." lines.
const listings = new Map();
for (const block of page.split(/\n\s*- \*\*Model name:\*\*/).slice(1)) {
  const field = (name) => block.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*([^\\n]+)`))?.[1].trim();
  const ids = field("Model ID")?.match(/[a-z0-9-]+\.[a-z0-9.:-]+/g) ?? [];
  for (const id of ids) listings.set(id, { legacy: field("Legacy date"), eol: field("EOL date") });
}
if (listings.size === 0) {
  throw new Error(`No "Model ID" entries found on ${PAGE}; the page format changed, update this parser.`);
}

const hits = registry.filter((m) => listings.has(baseId(m.id)));
console.log(`${registry.length} registry models checked against ${listings.size} Legacy/EOL listings on the AWS page.`);
for (const m of hits) {
  const { legacy, eol } = listings.get(baseId(m.id));
  console.log(`  ${m.file}: ${m.name} (${m.id}) - Legacy ${legacy ?? "?"}, EOL ${eol ?? "?"}`);
}
if (hits.length > 0) {
  console.log("Remove these entries (CONTRIBUTING.md, 'Only ACTIVE models').");
  process.exitCode = 1;
}
