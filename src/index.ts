#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { converse, effortFor, type ConverseResult } from "./bedrock/converse.js";
import { generateImage, IMAGE_MODELS, getImageModel } from "./bedrock/image.js";
import { startVideoGeneration, getVideoStatus, VIDEO_MODELS } from "./bedrock/video.js";
import { embed, cosineSimilarity, EMBEDDING_MODELS, getEmbeddingModel } from "./bedrock/embed.js";
import { TEXT_MODELS, resolveModelId, getModelInfo } from "./models.js";
import { runJudge, formatJudgeReport } from "./judge.js";
import { EFFORT_LEVELS } from "./types.js";

// Read the version from package.json (one directory above the compiled
// dist/index.js) so the version reported to MCP clients cannot drift from the
// manifest.
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

const server = new McpServer({
  name: "bedrock-multi-model",
  version,
});

const effortParam = z.enum(EFFORT_LEVELS).optional().describe(
  "Thinking depth and token spend for models that take it (Claude except Haiku 4.5): low, medium, high, xhigh, max. " +
  "Opus 5.5 and Haiku 5.5 default to medium, the others to high. bedrock_ask rejects it for other models; " +
  "bedrock_compare and bedrock_judge apply it only to the models that take it."
);
const schemaParam = z.record(z.string(), z.unknown()).optional().describe(
  "JSON schema the reply must match (structured output). Object schemas need additionalProperties: false. " +
  "Supported by Claude, Mistral Large 3, Devstral 2, Qwen3, DeepSeek V3.2 and GPT-OSS; not by Nova, Llama, " +
  "Mistral Small, Pixtral or DeepSeek R1."
);

// A schema reply is shown as pretty JSON; when it did not parse, the raw text follows a note.
function replyBody(result: ConverseResult, schemaSent: boolean): string {
  if (!schemaSent) return result.text;
  if (result.json === undefined) return `*Reply was not valid JSON (stop: ${result.stopReason}):*\n\n${result.text}`;
  return "```json\n" + JSON.stringify(result.json, null, 2) + "\n```";
}

// --- Tool: bedrock_ask ---
// Send a prompt to any Bedrock model and get a response.
server.registerTool(
  "bedrock_ask",
  {
    description:
      "Send a prompt to any AWS Bedrock model via the Converse API. " +
      "Supports Claude, Llama, Mistral, Nova, Qwen, DeepSeek, GPT-OSS, and more. " +
      "Use short aliases (e.g. 'llama4', 'nova-pro') or full model IDs. " +
      "Pass schema to get JSON that matches it, and effort to set Claude's thinking depth.",
    inputSchema: {
      model: z.string().describe(
        "Model alias (e.g. 'claude-opus', 'llama4', 'mistral-large', 'nova-pro', 'deepseek') or full Bedrock model ID"
      ),
      prompt: z.string().describe("The user prompt to send to the model"),
      system: z.string().optional().describe("Optional system prompt"),
      temperature: z.number().min(0).max(1).optional().describe("Sampling temperature (0-1, default 0.7). Ignored by models that don't support it."),
      max_tokens: z.number().positive().optional().describe("Maximum tokens to generate"),
      effort: effortParam,
      schema: schemaParam,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ model, prompt, system, temperature, max_tokens, effort, schema }) => {
    try {
      const result = await converse({
        modelId: model,
        prompt,
        system,
        temperature,
        maxTokens: max_tokens,
        effort,
        schema,
      });

      const info = getModelInfo(result.modelId);
      const modelLabel = info ? `${info.name} (${info.provider})` : result.modelId;

      const header = `**${modelLabel}**\n` +
        `Tokens: ${result.inputTokens} in / ${result.outputTokens} out | ` +
        `Latency: ${(result.latencyMs / 1000).toFixed(1)}s | ` +
        `Stop: ${result.stopReason}${effort ? ` | Effort: ${effort}` : ""}\n\n---\n\n`;

      return { content: [{ type: "text" as const, text: header + replyBody(result, !!schema) }] };
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
      effort: effortParam,
      schema: schemaParam,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ models, prompt, system, temperature, max_tokens, effort, schema }) => {
    const results = await Promise.allSettled(
      models.map((m) =>
        converse({
          modelId: m,
          prompt,
          system,
          temperature,
          maxTokens: max_tokens,
          effort: effortFor(m, effort),
          schema,
        })
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
        const applied = effortFor(models[i], effort);
        sections.push(
          `## ${label}\n` +
          `*Tokens: ${r.inputTokens} in / ${r.outputTokens} out | ` +
          `Latency: ${(r.latencyMs / 1000).toFixed(1)}s${applied ? ` | Effort: ${applied}` : ""}*\n\n` +
          replyBody(r, !!schema)
        );
      } else {
        const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        sections.push(`## ${label}\n\n**Error:** ${errMsg}`);
      }
    }

    return { content: [{ type: "text" as const, text: sections.join("\n\n---\n\n") }] };
  }
);

// --- Tool: bedrock_judge ---
// Several models answer, a judge model scores them blind and picks a winner.
server.registerTool(
  "bedrock_judge",
  {
    description:
      "Send the same prompt to 2-5 Bedrock models, then have a judge model (default Claude Opus) " +
      "score the answers blind - shuffled and labeled A/B/C with model names hidden - and pick a winner. " +
      "Set synthesize to also get one merged answer that keeps the best of each.",
    inputSchema: {
      models: z.array(z.string()).min(2).max(5).describe(
        "List of 2-5 candidate model aliases or IDs (e.g. ['llama4', 'nova-pro', 'deepseek'])"
      ),
      prompt: z.string().describe("The prompt every candidate answers"),
      judge: z.string().optional().describe("Judge model alias or ID (default 'claude-opus')"),
      criteria: z.string().optional().describe(
        "What the judge scores on (default 'correctness, completeness, clarity and concision')"
      ),
      synthesize: z.boolean().optional().describe("Also return one merged final answer (default false)"),
      system: z.string().optional().describe("Optional system prompt sent to the candidates"),
      temperature: z.number().min(0).max(1).optional().describe("Sampling temperature for the candidates"),
      max_tokens: z.number().positive().optional().describe("Maximum tokens per candidate response"),
      effort: effortParam,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ models, prompt, judge, criteria, synthesize, system, temperature, max_tokens, effort }) => {
    try {
      const report = await runJudge({
        models,
        prompt,
        judge,
        criteria,
        synthesize,
        system,
        temperature,
        maxTokens: max_tokens,
        effort,
      });
      return { content: [{ type: "text" as const, text: formatJudgeReport(report) }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    }
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
        "Filter by provider (e.g. 'Anthropic', 'Meta', 'Mistral', 'Amazon', 'Qwen', 'DeepSeek', 'OpenAI')"
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
      const caps = m.effort ? [...m.capabilities, "effort"] : m.capabilities;
      lines.push(`| ${m.name} | ${m.provider} | ${m.useCase} | ${m.aliases.join(", ")} | ${caps.join(", ")} |`);
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
      "Generate an image from a text prompt using AWS Bedrock image models " +
      "(Stable Image Ultra, Stable Diffusion 3.5 Large, Stable Image Core). " +
      "Saves the image to the current working directory by default (or output_dir if passed, " +
      "or BEDROCK_MCP_OUTPUT_DIR env var, falling back to ~/bedrock-images/ if cwd is not writable).",
    inputSchema: {
      model: z.string().optional().describe(
        "Image model alias: 'stable-ultra' (default, best quality), 'sd3.5', 'stable-core' (fastest/cheapest), or a full model ID"
      ),
      prompt: z.string().describe("Text description of the image to generate"),
      negative_prompt: z.string().optional().describe("What to exclude from the image (e.g. 'blurry, low quality')"),
      width: z.number().positive().optional().describe(
        "Desired width (default 1024). Stability models take an aspect ratio, not pixel " +
        "dimensions: width and height only pick the closest supported ratio (1:1, 16:9, " +
        "9:16, 3:2, 2:3, 4:5, 5:4, 21:9, 9:21) and the model chooses the output pixels. " +
        "The reported size is measured from the saved PNG."
      ),
      height: z.number().positive().optional().describe(
        "Desired height (default 1024). See `width` - only the resulting aspect ratio is sent."
      ),
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
        model: model ?? "stable-ultra",
        prompt,
        negativePrompt: negative_prompt,
        width,
        height,
        seed,
        outputDir: output_dir,
      });

      const entry = getImageModel(model ?? "stable-ultra");
      const label = entry ? `${entry.name} (${entry.provider})` : result.modelId;

      const size =
        result.width && result.height ? `Size: ${result.width}x${result.height} | ` : "";
      const text = `**${label}** - Image generated\n` +
        `${size}Latency: ${(result.latencyMs / 1000).toFixed(1)}s\n\n` +
        `Saved to: \`${result.filePath}\``;

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
    }
  }
);

// --- Tool: bedrock_generate_video ---
// Start an async video generation job using Luma Ray 2.
server.registerTool(
  "bedrock_generate_video",
  {
    description:
      "Start a video generation job using Luma Ray 2 on AWS Bedrock. " +
      "Videos are generated asynchronously and saved to an S3 bucket. " +
      "Returns a job ARN - use bedrock_video_status to check progress. " +
      "Note: the output S3 bucket must be in us-west-2 (the model region).",
    inputSchema: {
      model: z.string().optional().describe(
        "Video model alias: 'luma-ray' / 'ray2' (default), or a full model ID"
      ),
      prompt: z.string().describe("Text description of the video to generate"),
      s3_uri: z.string().describe("S3 URI for output (e.g. 's3://my-bucket/videos/'). Bucket must be in the model's region."),
      duration_seconds: z.union([z.literal(5), z.literal(9)]).optional().describe(
        "Video duration in seconds: 5 (default) or 9. Luma Ray 2 supports no other value."
      ),
    },
    annotations: { openWorldHint: true },
  },
  async ({ model, prompt, s3_uri, duration_seconds }) => {
    try {
      const result = await startVideoGeneration({
        model,
        prompt,
        s3Uri: s3_uri,
        durationSeconds: duration_seconds,
      });

      const text = `**${result.modelName}** - Video generation started\n` +
        `Duration: ${result.durationSeconds}s | Resolution: 720p` +
        `${result.region ? ` | Region: ${result.region}` : ""}\n\n` +
        `Job ARN: \`${result.invocationArn}\`\n` +
        `Output: \`${result.s3Uri}\`\n\n` +
        `Use \`bedrock_video_status\` to check progress. ` +
        `Expected time: ~90 seconds.`;

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
      "Check the status of a Bedrock video generation job (Luma Ray 2). " +
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
        text += `\nOutput: \`${result.s3Uri}/output.mp4\``;
      } else if (result.status === "InProgress") {
        text += `\nStill generating... check again in a minute.`;
      } else if (result.failureMessage) {
        text += `\nReason: ${result.failureMessage}`;
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
void VIDEO_MODELS;
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
