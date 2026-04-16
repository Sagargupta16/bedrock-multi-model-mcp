#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { converse } from "./converse.js";
import { MODEL_REGISTRY, MODEL_ALIASES, resolveModelId, getModelInfo } from "./models.js";

const server = new McpServer({
  name: "bedrock-multi-model",
  version: "0.1.0",
});

// --- Tool: bedrock_ask ---
// Send a prompt to any Bedrock model and get a response.
server.tool(
  "bedrock_ask",
  "Send a prompt to any AWS Bedrock model via the Converse API. " +
    "Supports Claude, Llama, Mistral, Nova, Cohere, DeepSeek, and more. " +
    "Use short aliases (e.g. 'llama4', 'nova-pro') or full model IDs.",
  {
    model: z.string().describe(
      "Model alias (e.g. 'llama4', 'mistral-large', 'nova-pro', 'deepseek') or full Bedrock model ID"
    ),
    prompt: z.string().describe("The user prompt to send to the model"),
    system: z.string().optional().describe("Optional system prompt"),
    temperature: z.number().min(0).max(1).optional().describe("Sampling temperature (0-1, default 0.7)"),
    max_tokens: z.number().positive().optional().describe("Maximum tokens to generate"),
  },
  async ({ model, prompt, system, temperature, max_tokens }) => {
    try {
      const result = await converse({
        modelId: model,
        prompt,
        system,
        temperature,
        maxTokens: max_tokens,
      });

      const info = getModelInfo(result.modelId);
      const modelLabel = info ? `${info.name} (${info.provider})` : result.modelId;

      const header = `**${modelLabel}**\n` +
        `Tokens: ${result.inputTokens} in / ${result.outputTokens} out | ` +
        `Latency: ${(result.latencyMs / 1000).toFixed(1)}s | ` +
        `Stop: ${result.stopReason}\n\n---\n\n`;

      return { content: [{ type: "text" as const, text: header + result.text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    }
  }
);

// --- Tool: bedrock_compare ---
// Send the same prompt to multiple models and compare responses side by side.
server.tool(
  "bedrock_compare",
  "Send the same prompt to multiple Bedrock models and compare responses side by side. " +
    "Useful for evaluating model quality, speed, and style differences.",
  {
    models: z.array(z.string()).min(2).max(5).describe(
      "List of 2-5 model aliases or IDs to compare (e.g. ['llama4', 'nova-pro', 'mistral-large'])"
    ),
    prompt: z.string().describe("The prompt to send to all models"),
    system: z.string().optional().describe("Optional system prompt sent to all models"),
    temperature: z.number().min(0).max(1).optional().describe("Sampling temperature for all models"),
    max_tokens: z.number().positive().optional().describe("Maximum tokens per model response"),
  },
  async ({ models, prompt, system, temperature, max_tokens }) => {
    const results = await Promise.allSettled(
      models.map((m) =>
        converse({ modelId: m, prompt, system, temperature, maxTokens: max_tokens })
      )
    );

    const sections: string[] = [];
    for (let i = 0; i < models.length; i++) {
      const result = results[i];
      const resolvedId = resolveModelId(models[i]);
      const info = getModelInfo(resolvedId);
      const label = info ? `${info.name} (${info.provider})` : resolvedId;

      if (result.status === "fulfilled") {
        const r = result.value;
        sections.push(
          `## ${label}\n` +
          `*Tokens: ${r.inputTokens} in / ${r.outputTokens} out | ` +
          `Latency: ${(r.latencyMs / 1000).toFixed(1)}s*\n\n` +
          r.text
        );
      } else {
        const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        sections.push(`## ${label}\n\n**Error:** ${errMsg}`);
      }
    }

    return { content: [{ type: "text" as const, text: sections.join("\n\n---\n\n") }] };
  }
);

// --- Tool: bedrock_list_models ---
// List all models in the registry with their capabilities.
server.tool(
  "bedrock_list_models",
  "List available Bedrock models with their aliases, providers, and capabilities. " +
    "Filter by provider name if needed.",
  {
    provider: z.string().optional().describe(
      "Filter by provider (e.g. 'Meta', 'Mistral', 'Amazon', 'Cohere', 'AI21', 'DeepSeek')"
    ),
  },
  async ({ provider }) => {
    let entries = Object.values(MODEL_REGISTRY);

    if (provider) {
      const lower = provider.toLowerCase();
      entries = entries.filter((m) => m.provider.toLowerCase() === lower);
    }

    // Build alias lookup (model ID -> aliases)
    const aliasLookup: Record<string, string[]> = {};
    for (const [alias, modelId] of Object.entries(MODEL_ALIASES)) {
      if (!aliasLookup[modelId]) aliasLookup[modelId] = [];
      aliasLookup[modelId].push(alias);
    }

    const lines: string[] = ["| Model | Provider | Aliases | Capabilities |", "| --- | --- | --- | --- |"];
    for (const m of entries) {
      const aliases = aliasLookup[m.id]?.join(", ") ?? "-";
      lines.push(`| ${m.name} | ${m.provider} | ${aliases} | ${m.capabilities.join(", ")} |`);
    }

    if (entries.length === 0) {
      const text = provider
        ? `No models found for provider "${provider}". Available providers: Anthropic, Meta, Mistral, Amazon, Cohere, AI21, DeepSeek`
        : "No models in registry.";
      return { content: [{ type: "text" as const, text }] };
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
