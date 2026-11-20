import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PROMPT_NAMES, registerPrompts } from "./prompts.js";

async function connect(): Promise<Client> {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerPrompts(server);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function textOf(client: Client, name: string, args: Record<string, string>): Promise<string> {
  const res = await client.getPrompt({ name, arguments: args });
  assert.equal(res.messages.length, 1);
  const msg = res.messages[0];
  assert.equal(msg.role, "user");
  assert.equal(msg.content.type, "text");
  return msg.content.type === "text" ? msg.content.text : "";
}

test("listPrompts returns the three prompts with descriptions", async () => {
  const client = await connect();
  const { prompts } = await client.listPrompts();
  assert.deepEqual(prompts.map((p) => p.name).sort(), [...PROMPT_NAMES].sort());
  for (const p of prompts) assert.ok(p.description);
  await client.close();
});

test("each prompt names its tool and contains the question", async () => {
  const client = await connect();
  const cases: [string, string][] = [
    ["second-opinion", "bedrock_ask"],
    ["compare-models", "bedrock_compare"],
    ["panel-discussion", "bedrock_panel"],
  ];
  for (const [name, tool] of cases) {
    const text = await textOf(client, name, { question: "Is Rust faster than Go?" });
    assert.ok(text.includes(tool), `${name} names ${tool}`);
    assert.ok(text.includes("Is Rust faster than Go?"));
  }
  await client.close();
});

test("optional arguments default and apply when given", async () => {
  const client = await connect();
  assert.ok((await textOf(client, "second-opinion", { question: "q" })).includes("gpt-astra"));
  assert.ok((await textOf(client, "second-opinion", { question: "q", model: "grok" })).includes('"grok"'));
  assert.ok((await textOf(client, "panel-discussion", { question: "q" })).includes('"medium"'));
  assert.ok((await textOf(client, "panel-discussion", { question: "q", level: "cheap" })).includes('"cheap"'));
  assert.ok((await textOf(client, "compare-models", { question: "q" })).includes("bedrock_list_models"));
  assert.ok((await textOf(client, "compare-models", { question: "q", models: "a,b" })).includes('"a,b"'));
  await client.close();
});

test("a missing question is rejected", async () => {
  const client = await connect();
  for (const name of PROMPT_NAMES) {
    await assert.rejects(client.getPrompt({ name, arguments: {} }));
  }
  await client.close();
});
