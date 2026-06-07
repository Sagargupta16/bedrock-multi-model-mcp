#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { converse } from "./bedrock/converse.js";
import { generateImage, IMAGE_MODELS, getImageModel } from "./bedrock/image.js";
import { startVideoGeneration, getVideoStatus } from "./bedrock/video.js";
import { embed, cosineSimilarity, EMBEDDING_MODELS, getEmbeddingModel } from "./bedrock/embed.js";
import { TEXT_MODELS, resolveModelId, getModelInfo } from "./models.js";

const server = new McpServer({
  name: "bedrock-multi-model",
  version: "0.3.0",
});

// --- Tool: bedrock_ask ---
// Send a prompt to any Bedrock model and get a response.
server.registerTool(
  "bedrock_ask",
  {
    description:
      "Send a prompt to any AWS Bedrock model via the Converse API. " +
      "Supports Claude, Llama, Mistral, Nova, Qwen, DeepSeek, GPT-OSS, and more. " +
      "Use short aliases (e.g. 'llama4', 'nova-pro') or full model IDs.",
    inputSchema: {
      model: z.string().describe(
        "Model alias (e.g. 'claude-opus', 'llama4', 'mistral-large', 'nova-pro', 'deepseek') or full Bedrock model ID"
      ),
      prompt: z.string().describe("The user prompt to send to the model"),
      system: z.string().optional().describe("Optional system prompt"),
      temperature: z.number().min(0).max(1).optional().describe("Sampling temperature (0-1, default 0.7). Ignored by models that don't support it."),
      max_tokens: z.number().positive().optional().describe("Maximum tokens to generate"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
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
server.registerTool(
  "bedrock_compare",
  {
    description:
      "Send the same prompt to multiple Bedrock models and compare responses side by side. " +
      "Useful for evaluating model quality, speed, and style differences.",
    inputSchema: {
      models: z.array(z.string()).min(2).max(5).describe(
        "List of 2-5 model aliases or IDs to compare (e.g. ['llama4', 'nova-pro', 'mistral-large'])"
      ),
      prompt: z.string().describe("The prompt to send to all models"),
      system: z.string().optional().describe("Optional system prompt sent to all models"),
      temperature: z.number().min(0).max(1).optional().describe("Sampling temperature for all models"),
      max_tokens: z.number().positive().optional().describe("Maximum tokens per model response"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
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
server.registerTool(
  "bedrock_list_models",
  {
    description:
      "List available Bedrock text models with their aliases, providers, use cases, and capabilities. " +
      "Filter by provider name if needed.",
    inputSchema: {
      provider: z.string().optional().describe(
        "Filter by provider (e.g. 'Anthropic', 'Meta', 'Mistral', 'Amazon', 'Qwen', 'AI21', 'DeepSeek', 'OpenAI')"
      ),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ provider }) => {
    let entries = TEXT_MODELS;

    if (provider) {
      const lower = provider.toLowerCase();
      entries = entries.filter((m) => m.provider.toLowerCase() === lower);
    }

    if (entries.length === 0) {
      const providers = [...new Set(TEXT_MODELS.map((m) => m.provider))].join(", ");
      return {
        content: [{ type: "text" as const, text: `No models found for provider "${provider}". Available providers: ${providers}` }],
      };
    }

    const lines: string[] = [
      "| Model | Provider | Use case | Aliases | Capabilities |",
      "| --- | --- | --- | --- | --- |",
    ];
    for (const m of entries) {
      lines.push(`| ${m.name} | ${m.provider} | ${m.useCase} | ${m.aliases.join(", ")} | ${m.capabilities.join(", ")} |`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// --- Tool: bedrock_generate_image ---
// Generate an image using Bedrock image models.
server.registerTool(
  "bedrock_generate_image",
  {
    description:
      "Generate an image from a text prompt using AWS Bedrock image models (Amazon Nova Canvas, Titan Image Generator v2). " +
      "Saves the image to the current working directory by default (or output_dir if passed, " +
      "or BEDROCK_MCP_OUTPUT_DIR env var, falling back to ~/bedrock-images/ if cwd is not writable).",
    inputSchema: {
      model: z.string().optional().describe(
        "Image model alias: 'nova-canvas' (default) or 'titan-image', or a full model ID"
      ),
      prompt: z.string().describe("Text description of the image to generate"),
      negative_prompt: z.string().optional().describe("What to exclude from the image (e.g. 'blurry, low quality')"),
      width: z.number().positive().optional().describe("Image width in pixels (default 1024, must be divisible by 16)"),
      height: z.number().positive().optional().describe("Image height in pixels (default 1024, must be divisible by 16)"),
      seed: z.number().optional().describe("Random seed for reproducible results"),
      output_dir: z.string().optional().describe(
        "Directory to save the image. Absolute or relative to cwd. " +
        "Auto-created if missing. Overrides BEDROCK_MCP_OUTPUT_DIR and default resolution."
      ),
    },
    annotations: { openWorldHint: true },
  },
  async ({ model, prompt, negative_prompt, width, height, seed, output_dir }) => {
    try {
      const result = await generateImage({
        model: model ?? "nova-canvas",
        prompt,
        negativePrompt: negative_prompt,
        width,
        height,
        seed,
        outputDir: output_dir,
      });

      const entry = getImageModel(model ?? "nova-canvas");
      const label = entry ? `${entry.name} (${entry.provider})` : result.modelId;

      const text = `**${label}** - Image generated\n` +
        `Size: ${result.width}x${result.height} | Latency: ${(result.latencyMs / 1000).toFixed(1)}s\n\n` +
        `Saved to: \`${result.filePath}\``;

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    }
  }
);

// --- Tool: bedrock_generate_video ---
// Start an async video generation job using Nova Reel.
server.registerTool(
  "bedrock_generate_video",
  {
    description:
      "Start a video generation job using Amazon Nova Reel. " +
      "Videos are generated asynchronously and saved to an S3 bucket. " +
      "Returns a job ARN - use bedrock_video_status to check progress.",
    inputSchema: {
      prompt: z.string().describe("Text description of the video to generate (max 512 chars for 6s, 4000 for multi-shot)"),
      s3_uri: z.string().describe("S3 URI for output (e.g. 's3://my-bucket/videos/')"),
      duration_seconds: z.number().optional().describe(
        "Video duration: 6 (default, single shot) or 12-120 in multiples of 6 (multi-shot)"
      ),
      seed: z.number().optional().describe("Random seed for reproducible results"),
    },
    annotations: { openWorldHint: true },
  },
  async ({ prompt, s3_uri, duration_seconds, seed }) => {
    try {
      const result = await startVideoGeneration({
        prompt,
        s3Uri: s3_uri,
        durationSeconds: duration_seconds,
        seed,
      });

      const text = `**Nova Reel** - Video generation started\n` +
        `Duration: ${result.durationSeconds}s | Resolution: 1280x720 @ 24fps\n\n` +
        `Job ARN: \`${result.invocationArn}\`\n` +
        `Output: \`${result.s3Uri}\`\n\n` +
        `Use \`bedrock_video_status\` to check progress. ` +
        `Expected time: ~${result.durationSeconds <= 6 ? "90 seconds" : Math.ceil(result.durationSeconds / 6) * 1.5 + " minutes"}.`;

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    }
  }
);

// --- Tool: bedrock_video_status ---
// Check the status of an async video generation job.
server.registerTool(
  "bedrock_video_status",
  {
    description:
      "Check the status of a Nova Reel video generation job. " +
      "Returns status (InProgress, Completed, Failed) and output location.",
    inputSchema: {
      invocation_arn: z.string().describe("The job ARN returned by bedrock_generate_video"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ invocation_arn }) => {
    try {
      const result = await getVideoStatus(invocation_arn);

      let text = `**Video Job Status: ${result.status}**\n`;
      if (result.submitTime) text += `Started: ${result.submitTime}\n`;
      if (result.endTime) text += `Finished: ${result.endTime}\n`;

      if (result.status === "Completed" && result.s3Uri) {
        text += `\nOutput: \`${result.s3Uri}/output.mp4\`\n`;
        text += `Individual shots also available at \`${result.s3Uri}/shot_XXXX.mp4\``;
      } else if (result.status === "InProgress") {
        text += `\nStill generating... check again in a minute.`;
      }

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    }
  }
);

// --- Tool: bedrock_embed_similarity ---
// Embed 2+ texts and return a cosine-similarity matrix.
server.registerTool(
  "bedrock_embed_similarity",
  {
    description:
      "Embed 2 or more texts with an AWS Bedrock embedding model (Amazon Titan, Cohere) and " +
      "return a cosine-similarity matrix. Scores range 0 (unrelated) to 1 (identical meaning). " +
      "Useful for semantic search, deduplication, and clustering.",
    inputSchema: {
      texts: z.array(z.string()).min(2).max(50).describe(
        "List of 2-50 texts to embed and compare pairwise"
      ),
      model: z.string().optional().describe(
        "Embedding model alias: 'titan-v2' (default), 'titan-v1', 'cohere-en', 'cohere-multi', or a full model ID"
      ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ texts, model }) => {
    try {
      const entry = getEmbeddingModel(model ?? "titan-v2");
      const modelId = entry?.id ?? model ?? "amazon.titan-embed-text-v2:0";
      const label = entry ? `${entry.name} (${entry.provider})` : modelId;

      const vectors = await embed(modelId, texts);

      // Build a markdown similarity matrix with short text labels.
      const labels = texts.map((t, i) => `${i + 1}. ${t.length > 24 ? t.slice(0, 21) + "..." : t}`);
      const header = `| | ${texts.map((_, i) => i + 1).join(" | ")} |`;
      const divider = `| --- |${texts.map(() => " --- |").join("")}`;
      const rows = vectors.map((v, i) => {
        const cells = vectors.map((w, j) =>
          i === j ? "1.00" : cosineSimilarity(v, w).toFixed(2)
        );
        return `| **${i + 1}** | ${cells.join(" | ")} |`;
      });

      const text =
        `**${label}** - cosine similarity (${texts.length} texts)\n\n` +
        labels.join("\n") +
        `\n\n${header}\n${divider}\n${rows.join("\n")}`;

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    }
  }
);

// Touch the catalogs so the imports are retained and they validate at startup.
void IMAGE_MODELS;
void EMBEDDING_MODELS;

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
