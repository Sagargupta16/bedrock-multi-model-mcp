#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { converse } from "./converse.js";
import { MODEL_REGISTRY, MODEL_ALIASES, resolveModelId, getModelInfo } from "./models.js";
import { generateImage, IMAGE_MODELS } from "./image.js";
import { startVideoGeneration, getVideoStatus } from "./video.js";

const server = new McpServer({
  name: "bedrock-multi-model",
  version: "0.2.0",
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

// --- Tool: bedrock_generate_image ---
// Generate an image using Bedrock image models.
server.tool(
  "bedrock_generate_image",
  "Generate an image from a text prompt using AWS Bedrock image models. " +
    "Supports Nova Canvas, Titan Image, Stable Diffusion 3.5, and SDXL. " +
    "Saves the image to ~/bedrock-images/ and returns the file path.",
  {
    model: z.string().optional().describe(
      "Image model alias: 'nova-canvas' (default), 'titan-image', 'sd3.5-large', 'sdxl', or a full model ID"
    ),
    prompt: z.string().describe("Text description of the image to generate"),
    negative_prompt: z.string().optional().describe("What to exclude from the image (e.g. 'blurry, low quality')"),
    width: z.number().positive().optional().describe("Image width in pixels (default 1024, must be divisible by 16)"),
    height: z.number().positive().optional().describe("Image height in pixels (default 1024, must be divisible by 16)"),
    style: z.string().optional().describe(
      "Style preset. Nova Canvas: PHOTOREALISM, 3D_ANIMATED_FAMILY_FILM, DESIGN_SKETCH, etc. " +
      "SDXL: photographic, digital_art, cinematic, comic_book, fantasy_art, line_art, etc."
    ),
    seed: z.number().optional().describe("Random seed for reproducible results"),
  },
  async ({ model, prompt, negative_prompt, width, height, style, seed }) => {
    try {
      const result = await generateImage({
        model: model ?? "nova-canvas",
        prompt,
        negativePrompt: negative_prompt,
        width,
        height,
        style,
        seed,
      });

      const entry = IMAGE_MODELS[model?.toLowerCase() ?? "nova-canvas"];
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
server.tool(
  "bedrock_generate_video",
  "Start a video generation job using Amazon Nova Reel. " +
    "Videos are generated asynchronously and saved to an S3 bucket. " +
    "Returns a job ARN - use bedrock_video_status to check progress.",
  {
    prompt: z.string().describe("Text description of the video to generate (max 512 chars for 6s, 4000 for multi-shot)"),
    s3_uri: z.string().describe("S3 URI for output (e.g. 's3://my-bucket/videos/')"),
    duration_seconds: z.number().optional().describe(
      "Video duration: 6 (default, single shot) or 12-120 in multiples of 6 (multi-shot)"
    ),
    seed: z.number().optional().describe("Random seed for reproducible results"),
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
server.tool(
  "bedrock_video_status",
  "Check the status of a Nova Reel video generation job. " +
    "Returns status (InProgress, Completed, Failed) and output location.",
  {
    invocation_arn: z.string().describe("The job ARN returned by bedrock_generate_video"),
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

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
