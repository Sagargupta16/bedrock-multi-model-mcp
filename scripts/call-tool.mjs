#!/usr/bin/env node
// Minimal MCP client: spawns the built server (dist/index.js) over stdio, the
// same way Claude Code does, and calls one tool. Useful as a smoke test and
// for trying a tool without an MCP client.
//
//   npm run build
//   node scripts/call-tool.mjs                       # list the tools
//   node scripts/call-tool.mjs bedrock_list_models '{"provider":"Meta"}'
//   node scripts/call-tool.mjs bedrock_judge '{"models":["llama4","nova-pro"],"prompt":"..."}'
//
// AWS credentials come from this shell's environment, exactly as they would
// from the "env" block of an MCP client config.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const [tool, rawArgs = "{}"] = process.argv.slice(2);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  // The SDK passes only a minimal safe environment by default; forward the
  // whole shell environment so AWS_* variables reach the server.
  env: { ...process.env },
});
const client = new Client({ name: "call-tool", version: "1.0.0" });
await client.connect(transport);

try {
  if (!tool) {
    const { tools } = await client.listTools();
    for (const t of tools) console.log(`${t.name.padEnd(26)} ${t.description?.split(". ")[0]}`);
  } else {
    const result = await client.callTool({ name: tool, arguments: JSON.parse(rawArgs) });
    for (const block of result.content) {
      if (block.type === "text") console.log(block.text);
    }
    if (result.isError) process.exitCode = 1;
  }
} finally {
  await client.close();
}
