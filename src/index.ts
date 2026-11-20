#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { z } from "zod";
import { converse, effortFor, type ConverseResult } from "./bedrock/converse.js";
import { generateImage, getImageModel } from "./bedrock/image.js";
import { editImage, EDIT_MODELS, STYLE_PRESETS, EDIT_ASPECT_RATIOS, OUTPUT_FORMATS } from "./bedrock/edit.js";
import { startVideoGeneration, getVideoStatus } from "./bedrock/video.js";
import { embedInputs, cosineSimilarity, getEmbeddingModel, type EmbedInput } from "./bedrock/embed.js";
import { TEXT_MODELS, resolveModelId, getModelInfo } from "./models.js";
import { runJudge, formatJudgeReport } from "./judge.js";
import {
  runPanel,
  formatPanelReport,
  levelHelp,
  pickModel,
  pickModels,
  costTotal,
  LEVEL_IDS,
  MAX_ROLE_LENGTH,
} from "./panel.js";
import { runDoctor, formatDoctorReport } from "./doctor.js";
import { loadFiles, withFiles, filesHelp } from "./files.js";
import { estimateCost, formatCost } from "./cost.js";
import { conversations, conversationHelp, CONVERSATION_ID_PATTERN } from "./conversation.js";
import { registerPrompts } from "./prompts.js";
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
  "Thinking depth and token spend for models that take it (Claude except Haiku 4.5, GPT-6.x, Grok 4.7, " +
  "Kimi K3, Gemma 4 up to xhigh): low, medium, high, xhigh, max. Claude Opus 5.5 and Haiku 5.5 default to " +
  "medium. bedrock_ask rejects it for other models; bedrock_compare, bedrock_judge and bedrock_panel apply it " +
  "only to the models that take it."
);
const schemaParam = z.record(z.string(), z.unknown()).optional().describe(
  "JSON schema the reply must match (structured output). Object schemas need additionalProperties: false. " +
  "Supported by Claude, GPT-6.x, GPT-OSS, Grok 4.7, Kimi K3, Gemma 4, Mistral Large 3, Ministral 3, Qwen3, " +
  "DeepSeek V3.2, MiniMax M2.5 and Nemotron 3 Super; not by Nova, Pixtral or Magistral Small."
);
const maxTokensParam = z.number().int().positive().optional();
const filesParam = z.array(z.string()).optional().describe(
  "Local text file paths, relative to the files root (BEDROCK_MCP_FILES_ROOT or the server's working folder). " +
  "Each file is appended to the prompt and its content is sent to the model provider."
);
// The files sentence every text tool description carries.
const filesNote = `files: ${filesHelp()} A refused file fails the call before any model is billed.`;

// Reads the files of a call before any model call: a refusal throws, so the tool
// returns it as its error and nothing is billed. The line names what was attached.
async function attachFiles(prompt: string, paths: string[] | undefined): Promise<{ prompt: string; line: string }> {
  const files = paths && paths.length > 0 ? await loadFiles(paths) : [];
  const line = files.length > 0
    ? `Files: ${files.map((f) => `${f.path} (${f.bytes} bytes)`).join(", ")}\n`
    : "";
  return { prompt: withFiles(prompt, files), line };
}

// A schema reply is shown as pretty JSON; when it did not parse, the raw text follows a note.
function replyBody(result: ConverseResult, schemaSent: boolean): string {
  if (!schemaSent) return result.text;
  if (result.json === undefined) return `*Reply was not valid JSON (stop: ${result.stopReason}):*\n\n${result.text}`;
  return "```json\n" + JSON.stringify(result.json, null, 2) + "\n```";
}

// Every tool reports a thrown error the same way: its message, flagged isError.
function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// --- Tool: bedrock_ask ---
// Send a prompt to any Bedrock model and get a response.
server.registerTool(
  "bedrock_ask",
  {
    description:
      "Send a prompt to any AWS Bedrock model via the Converse API. " +
      "Supports Claude, GPT, Grok, Kimi, Gemma, Mistral, Nova, Qwen, DeepSeek, and more. " +
      "Use short aliases (e.g. 'claude-sonnet', 'nova-pro') or full model IDs, or pass level instead of model " +
      "to use the first model of that level. " +
      "Pass schema to get JSON that matches it, and effort to set the thinking depth. " +
      `${filesNote} ${conversationHelp()} ` +
      "The reply header shows the tokens and an estimated cost from list prices.",
    inputSchema: {
      model: z.string().optional().describe(
        "Model alias (e.g. 'claude-opus', 'kimi', 'mistral-large', 'nova-pro', 'deepseek') or full Bedrock model ID. " +
        "Required unless level is given; model and level together is an error."
      ),
      level: z.enum(LEVEL_IDS).optional().describe(
        `Use the first model of a level instead of model: ${levelHelp()}.`
      ),
      prompt: z.string().describe("The user prompt to send to the model"),
      system: z.string().optional().describe("Optional system prompt"),
      temperature: z.number().min(0).max(1).optional().describe("Sampling temperature (0-1, default 0.7). Ignored by models that don't support it."),
      max_tokens: maxTokensParam.describe("Maximum tokens to generate"),
      effort: effortParam,
      schema: schemaParam,
      files: filesParam,
      conversation_id: z.string().optional().describe(
        "Follow-up conversation id (1-64 letters, digits, '-' or '_'); omit for a one-off call. See the tool description."
      ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (
    { model, level, prompt, system, temperature, max_tokens, effort, schema, files, conversation_id },
    { signal },
  ) => {
    try {
      // Everything that can be refused is checked before the billed call.
      const modelId = pickModel(model, level);
      if (conversation_id !== undefined && !CONVERSATION_ID_PATTERN.test(conversation_id)) {
        throw new Error(
          `Invalid conversation_id: use 1 to 64 letters, digits, "-" or "_" (pattern ${CONVERSATION_ID_PATTERN.source}).`
        );
      }
      const attached = await attachFiles(prompt, files);
      const turn = conversation_id !== undefined ? conversations.turns(conversation_id).length + 1 : 0;

      const result = await converse({
        modelId,
        prompt: conversation_id !== undefined
          ? conversations.buildPrompt(conversation_id, attached.prompt)
          : attached.prompt,
        system,
        temperature,
        maxTokens: max_tokens,
        effort,
        schema,
        signal,
      });

      // The turn keeps the prompt as sent with its file blocks, so a follow-up still has the files.
      let conversationLine = "";
      if (conversation_id !== undefined) {
        const kept = conversations.append(conversation_id, {
          prompt: attached.prompt,
          reply: result.text,
          modelId: result.modelId,
        });
        conversationLine = `Conversation: ${conversation_id}, turn ${turn}` +
          `${kept ? "" : " (not kept: empty reply or over the size cap, so later turns will not see it)"}\n`;
      }

      const info = getModelInfo(result.modelId);
      const modelLabel = info ? `${info.name} (${info.provider})` : result.modelId;
      const cost = costTotal([result]);

      const header = `**${modelLabel}**\n` +
        attached.line +
        conversationLine +
        `Tokens: ${result.inputTokens} in / ${result.outputTokens} out | ` +
        `${cost ? `Est. cost: ${cost} | ` : ""}` +
        `Latency: ${(result.latencyMs / 1000).toFixed(1)}s | ` +
        `Stop: ${result.stopReason}${effort ? ` | Effort: ${effort}` : ""}\n\n---\n\n`;

      return { content: [{ type: "text" as const, text: header + replyBody(result, !!schema) }] };
    } catch (err) {
      return errorResult(err);
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
      "Useful for evaluating model quality, speed, and style differences. " +
      `Pass level instead of models for a default set of three: ${levelHelp()}; models wins when both are given. ` +
      `${filesNote} ` +
      "Each answer shows its tokens and an estimated cost from list prices, with the total at the end.",
    inputSchema: {
      models: z.array(z.string()).min(2).max(5).optional().describe(
        "List of 2-5 model aliases or IDs to compare (e.g. ['kimi', 'nova-pro', 'mistral-large']). " +
        "Required unless level is given."
      ),
      level: z.enum(LEVEL_IDS).optional().describe(
        `Default models when models is absent: ${levelHelp()}. Ignored when models is given.`
      ),
      prompt: z.string().describe("The prompt to send to all models"),
      system: z.string().optional().describe("Optional system prompt sent to all models"),
      temperature: z.number().min(0).max(1).optional().describe("Sampling temperature for all models"),
      max_tokens: maxTokensParam.describe("Maximum tokens per model response"),
      effort: effortParam,
      schema: schemaParam,
      files: filesParam,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ models: given, level, prompt: question, system, temperature, max_tokens, effort, schema, files }, { signal }) => {
    let models: string[];
    let attached: { prompt: string; line: string };
    try {
      models = pickModels("bedrock_compare", given, level);
      attached = await attachFiles(question, files);
    } catch (err) {
      return errorResult(err);
    }
    const prompt = attached.prompt;
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
          signal,
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
        const cost = formatCost(estimateCost(r.modelId, r.inputTokens, r.outputTokens));
        sections.push(
          `## ${label}\n` +
          `*Tokens: ${r.inputTokens} in / ${r.outputTokens} out | ` +
          `${cost ? `${cost} | ` : ""}` +
          `Latency: ${(r.latencyMs / 1000).toFixed(1)}s${applied ? ` | Effort: ${applied}` : ""}*\n\n` +
          replyBody(r, !!schema)
        );
      } else {
        const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        sections.push(`## ${label}\n\n**Error:** ${errMsg}`);
      }
    }

    // One estimate label per reply, on the total of the answered models.
    const total = costTotal(
      results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))
    );
    const text = attached.line + (attached.line ? "\n" : "") + sections.join("\n\n---\n\n") +
      (total ? `\n\n---\n\n*Est. cost: ${total} total*` : "");

    // Partial failures are part of a comparison; only an all-failed call is an error.
    const allFailed = results.every((r) => r.status === "rejected");
    return { content: [{ type: "text" as const, text }], isError: allFailed };
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
      "Set synthesize to also get one merged answer that keeps the best of each. " +
      `Pass level instead of models for three default candidates: ${levelHelp()}; models wins when both are ` +
      "given, and level never changes the judge. " +
      `${filesNote} The files reach the candidates and the judge. ` +
      "The report ends with an estimated cost from list prices for the answers plus the judge call.",
    inputSchema: {
      models: z.array(z.string()).min(2).max(5).optional().describe(
        "List of 2-5 candidate model aliases or IDs (e.g. ['kimi', 'nova-pro', 'deepseek']). " +
        "Required unless level is given."
      ),
      level: z.enum(LEVEL_IDS).optional().describe(
        `Default candidates when models is absent: ${levelHelp()}. Ignored when models is given; not the judge.`
      ),
      prompt: z.string().describe("The prompt every candidate answers"),
      judge: z.string().optional().describe("Judge model alias or ID (default 'claude-opus')"),
      criteria: z.string().optional().describe(
        "What the judge scores on (default 'correctness, completeness, clarity and concision')"
      ),
      synthesize: z.boolean().optional().describe("Also return one merged final answer (default false)"),
      system: z.string().optional().describe("Optional system prompt sent to the candidates"),
      temperature: z.number().min(0).max(1).optional().describe("Sampling temperature for the candidates"),
      max_tokens: maxTokensParam.describe("Maximum tokens per candidate response"),
      effort: effortParam,
      files: filesParam,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async (
    { models, level, prompt, judge, criteria, synthesize, system, temperature, max_tokens, effort, files },
    { signal },
  ) => {
    try {
      // Checked here too, so a bad model list fails before the files are read.
      pickModels("bedrock_judge", models, level);
      const attached = await attachFiles(prompt, files);
      const report = await runJudge({
        models,
        level,
        prompt: attached.prompt,
        judge,
        criteria,
        synthesize,
        system,
        temperature,
        maxTokens: max_tokens,
        effort,
        signal,
      });
      return {
        content: [{ type: "text" as const, text: attached.line + (attached.line ? "\n" : "") + formatJudgeReport(report) }],
      };
    } catch (err) {
      return errorResult(err);
    }
  }
);

// --- Tool: bedrock_panel ---
// 2-5 models discuss one prompt in turn, each seeing what the earlier ones said.
server.registerTool(
  "bedrock_panel",
  {
    description:
      "Run a short discussion between 2-5 Bedrock models and return the transcript. Unlike bedrock_compare, " +
      "the models answer in turn and each one sees what the earlier ones said, so they can agree, push back " +
      "and build on each other. Give each model a role (critic, builder, fact-checker, devils-advocate, " +
      "simplifier, moderator, or your own words), run 1-3 rounds, and set summarize to a model that closes " +
      "with where the panel agrees and disagrees. Pass level instead of models for a default panel of " +
      `three: ${levelHelp()}. Turns run one after another and each is billed: models x rounds generations, ` +
      "plus one for the summary. A model that fails loses its turn and the panel carries on. " +
      `${filesNote} The files are part of the question every turn sees. ` +
      "The totals line gives an estimated cost from list prices for the turns plus the summary.",
    inputSchema: {
      prompt: z.string().describe("The question or task the panel discusses"),
      models: z.array(z.string()).optional().describe(
        "2-5 model aliases or IDs, in speaking order (e.g. ['nova-pro', 'kimi', 'deepseek']). Required unless " +
        "level is given. A model may be listed twice only with different roles."
      ),
      roles: z.array(z.string().max(MAX_ROLE_LENGTH).nullable()).optional().describe(
        "One entry per model, in the same order: a preset (critic, builder, fact-checker, devils-advocate, " +
        "simplifier, moderator), free text up to 200 characters, or null for no role"
      ),
      rounds: z.number().int().min(1).max(3).optional().describe(
        "Rounds of discussion, 1-3 (default 1). In round 2 and 3 each model answers again having seen everything so far."
      ),
      summarize: z.string().optional().describe(
        "Model alias or ID that closes with a short summary of where the panel agrees and disagrees. It is " +
        "told it is the moderator and is not a panelist unless it is also in models."
      ),
      level: z.enum(LEVEL_IDS).optional().describe(
        `Default panel when models is absent: ${levelHelp()}. Ignored when models is given.`
      ),
      max_tokens: maxTokensParam.describe("Maximum tokens per turn"),
      effort: effortParam,
      files: filesParam,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ prompt, models, roles, rounds, summarize, level, max_tokens, effort, files }, { signal }) => {
    try {
      const attached = await attachFiles(prompt, files);
      const report = await runPanel({
        prompt: attached.prompt,
        models,
        roles,
        rounds,
        summarize,
        level,
        maxTokens: max_tokens,
        effort,
        signal,
      });
      // Like bedrock_compare: lost turns are part of a panel, only an all-failed one is an error.
      const allFailed = report.turns.every((t) => t.error);
      return {
        content: [{ type: "text" as const, text: attached.line + (attached.line ? "\n" : "") + formatPanelReport(report) }],
        isError: allFailed,
      };
    } catch (err) {
      return errorResult(err);
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
        "Filter by provider (e.g. 'Anthropic', 'OpenAI', 'xAI', 'Mistral', 'Amazon', 'Qwen', 'DeepSeek')"
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
      "| Model | Provider | Use case | Aliases | Capabilities | Price per 1M tokens (in / out) |",
      "| --- | --- | --- | --- | --- | --- |",
    ];
    for (const m of entries) {
      const caps = m.effort ? [...m.capabilities, "effort"] : m.capabilities;
      const price = m.price ? `$${m.price.input} / $${m.price.output}` : "-";
      lines.push(
        `| ${m.name} | ${m.provider} | ${m.useCase} | ${m.aliases.join(", ")} | ${caps.join(", ")} | ${price} |`
      );
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// --- Tool: bedrock_doctor ---
// One tiny call per text model, to show which work on this AWS account right now.
server.registerTool(
  "bedrock_doctor",
  {
    description:
      "Check which Bedrock text models work on this AWS account right now. Sends one small billed call " +
      `(a one-word prompt, at most 32 output tokens) to each model: every registry text model ` +
      `(${TEXT_MODELS.length}) by default, or only the models passed. Returns a table with one status per model: ` +
      "ok (answered), throttled (rate or quota limit right now; try again later), denied (no model access " +
      "or not authorized on this account), invalid (unknown model id, not in the registry, or not offered " +
      "in this region), error (anything else; see the note).",
    inputSchema: {
      models: z.array(z.string()).min(1).max(TEXT_MODELS.length).optional().describe(
        "Model aliases or IDs to check (default every text model in the registry); a repeated model is checked once"
      ),
      concurrency: z.number().int().min(1).max(8).optional().describe(
        "Models checked at the same time, 1-8 (default 4)"
      ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ models, concurrency }, { signal }) => {
    try {
      const report = await runDoctor({ models, concurrency, signal });
      return { content: [{ type: "text" as const, text: formatDoctorReport(report) }] };
    } catch (err) {
      return errorResult(err);
    }
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
      seed: z.number().int().nonnegative().optional().describe("Random seed for reproducible results"),
      output_dir: z.string().optional().describe(
        "Directory to save the image. Absolute or relative to cwd. " +
        "Auto-created if missing. Overrides BEDROCK_MCP_OUTPUT_DIR and default resolution."
      ),
    },
    annotations: { openWorldHint: true },
  },
  async ({ model, prompt, negative_prompt, width, height, seed, output_dir }, { signal }) => {
    try {
      const result = await generateImage({
        model: model ?? "stable-ultra",
        prompt,
        negativePrompt: negative_prompt,
        width,
        height,
        seed,
        outputDir: output_dir,
        signal,
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
      return errorResult(err);
    }
  }
);

// --- Tool: bedrock_edit_image ---
// Edit or transform a local image with one of Stability AI's image services.
const editOperations = EDIT_MODELS.map((m) => m.operation) as [string, ...string[]];
const editOperationHelp = EDIT_MODELS.map((m) => {
  const needs: string[] = m.requires.map((f) => (f === "style_image" ? "style_image_path" : f));
  if (m.requiresOneOf) needs.push(`one of ${m.requiresOneOf.join("/")}`);
  return `${m.operation}${needs.length ? ` (needs ${needs.join(", ")})` : ""}`;
}).join("; ");

server.registerTool(
  "bedrock_edit_image",
  {
    description:
      "Edit or transform a local image with Stability AI Image Services on AWS Bedrock: fill or erase a masked " +
      "area, extend the canvas, swap or recolor an object found by a prompt, remove the background, upscale, " +
      "draw from a sketch or structure, or apply a style. Saves the result as a PNG, like bedrock_generate_image.",
    inputSchema: {
      operation: z.enum(editOperations).describe(`What to do: ${editOperationHelp}`),
      image_path: z.string().describe(
        "Input image (PNG, JPEG or WebP), absolute or relative to cwd. For style-transfer, the image to restyle."
      ),
      prompt: z.string().optional().describe("What the output should show"),
      negative_prompt: z.string().optional().describe("What to keep out of the output"),
      mask_path: z.string().optional().describe(
        "inpaint, erase: black-and-white mask image, white where the image should change. " +
        "Without it, the input image's alpha channel is used as the mask."
      ),
      style_image_path: z.string().optional().describe("style-transfer: the image whose style is applied"),
      search_prompt: z.string().optional().describe("search-replace: the object to find and replace"),
      select_prompt: z.string().optional().describe("search-recolor: the object to find and recolor"),
      left: z.number().int().min(0).max(2000).optional().describe("outpaint: pixels to add on the left"),
      right: z.number().int().min(0).max(2000).optional().describe("outpaint: pixels to add on the right"),
      up: z.number().int().min(0).max(2000).optional().describe("outpaint: pixels to add on top"),
      down: z.number().int().min(0).max(2000).optional().describe("outpaint: pixels to add at the bottom"),
      creativity: z.number().min(0.1).max(1).optional().describe(
        "upscale-conservative and upscale-creative (0.1-0.5), outpaint (0.1-1): how much new detail to invent"
      ),
      control_strength: z.number().min(0).max(1).optional().describe(
        "control-sketch, control-structure: how closely the output follows the input (default 0.7)"
      ),
      grow_mask: z.number().int().min(0).max(20).optional().describe(
        "inpaint, erase, search-replace, search-recolor: pixels to grow and soften the mask edge (default 5)"
      ),
      fidelity: z.number().min(0).max(1).optional().describe(
        "style-guide: how closely the output follows the input image's style (default 0.5)"
      ),
      aspect_ratio: z.enum(EDIT_ASPECT_RATIOS).optional().describe("style-guide: output aspect ratio (default 1:1)"),
      composition_fidelity: z.number().min(0).max(1).optional().describe(
        "style-transfer: how closely the output keeps the input's composition (default 0.9)"
      ),
      style_strength: z.number().min(0).max(1).optional().describe(
        "style-transfer: how strongly the style image applies (default 1)"
      ),
      change_strength: z.number().min(0.1).max(1).optional().describe(
        "style-transfer: how much the input may change (default 0.9)"
      ),
      style_preset: z.enum(STYLE_PRESETS).optional().describe("Style preset, for the operations that take one"),
      seed: z.number().int().min(0).max(4294967294).optional().describe("Random seed for reproducible results"),
      output_format: z.enum(OUTPUT_FORMATS).optional().describe(
        "Result file format (default png; webp for the three upscale operations, whose PNG is over " +
        "Bedrock's 16 MB response limit)"
      ),
      output_dir: z.string().optional().describe(
        "Directory to save the image, as in bedrock_generate_image (BEDROCK_MCP_OUTPUT_DIR, cwd or ~/bedrock-images)"
      ),
    },
    annotations: { openWorldHint: true },
  },
  async (
    { operation, image_path, mask_path, style_image_path, output_format, output_dir, ...fields },
    { signal },
  ) => {
    try {
      const result = await editImage({
        operation,
        imagePath: image_path,
        maskPath: mask_path,
        styleImagePath: style_image_path,
        fields,
        outputFormat: output_format,
        outputDir: output_dir,
        signal,
      });
      const size =
        result.width && result.height ? `Size: ${result.width}x${result.height} | ` : "";
      const text = `**${result.modelName}** - Image edited\n` +
        `${size}Latency: ${(result.latencyMs / 1000).toFixed(1)}s\n\n` +
        `Saved to: \`${result.filePath}\``;
      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return errorResult(err);
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
      "Note: the output S3 bucket must be in us-west-2 (the model region). " +
      "Pass start_image_path and/or end_image_path to turn local images into the first and last frame " +
      "(image-to-video); the images are checked before the job is started.",
    inputSchema: {
      model: z.string().optional().describe(
        "Video model alias: 'luma-ray' / 'ray2' (default), or a full model ID"
      ),
      prompt: z.string().describe("Text description of the video to generate"),
      s3_uri: z.string().describe("S3 URI for output (e.g. 's3://my-bucket/videos/'). Bucket must be in the model's region."),
      duration_seconds: z.union([z.literal(5), z.literal(9)]).optional().describe(
        "Video duration in seconds: 5 (default) or 9. Luma Ray 2 supports no other value."
      ),
      start_image_path: z.string().optional().describe(
        "Local JPEG or PNG used as the first frame (512x512 to 4096x4096 pixels), absolute or relative to cwd"
      ),
      end_image_path: z.string().optional().describe(
        "Local JPEG or PNG used as the last frame (512x512 to 4096x4096 pixels), absolute or relative to cwd"
      ),
    },
    annotations: { openWorldHint: true },
  },
  // No abort signal and no retry around the start: a cancelled or repeated start can bill a job with no ARN.
  async ({ model, prompt, s3_uri, duration_seconds, start_image_path, end_image_path }) => {
    try {
      const result = await startVideoGeneration({
        model,
        prompt,
        s3Uri: s3_uri,
        durationSeconds: duration_seconds,
        startImagePath: start_image_path,
        endImagePath: end_image_path,
      });

      const text = `**${result.modelName}** - Video generation started\n` +
        `Duration: ${result.durationSeconds}s | Resolution: 720p` +
        `${result.region ? ` | Region: ${result.region}` : ""}` +
        `${result.keyframes ? ` | Keyframes: ${result.keyframes.join(", ")}` : ""}\n\n` +
        `Job ARN: \`${result.invocationArn}\`\n` +
        `Output: \`${result.s3Uri}\`\n\n` +
        `Use \`bedrock_video_status\` to check progress. ` +
        `Expected time: ~90 seconds.`;

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return errorResult(err);
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
  async ({ invocation_arn }, { signal }) => {
    try {
      const result = await getVideoStatus(invocation_arn, undefined, signal);

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
      return errorResult(err);
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
      "Useful for semantic search, deduplication, and clustering. " +
      "Pass images (local JPEG or PNG paths) beside or instead of texts to compare images with each other and " +
      "with texts; that needs a multimodal model ('titan-multimodal' or 'cohere'). At least 2 inputs in total.",
    inputSchema: {
      texts: z.array(z.string()).max(50).optional().describe(
        "List of up to 50 texts to embed and compare pairwise"
      ),
      images: z.array(z.string()).max(50).optional().describe(
        "Local JPEG or PNG paths (absolute or relative to cwd) to embed beside the texts; rows and columns " +
        "show the file name"
      ),
      model: z.string().optional().describe(
        "Embedding model alias: 'titan-v2' (default), 'titan-multimodal', 'cohere' (Embed v4), or a full model ID"
      ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ texts = [], images = [], model }, { signal }) => {
    try {
      const count = texts.length + images.length;
      if (count < 2 || count > 50) {
        throw new Error(`bedrock_embed_similarity needs 2 to 50 inputs across texts and images, got ${count}.`);
      }
      const entry = getEmbeddingModel(model ?? "titan-v2");
      const modelId = entry?.id ?? model ?? "amazon.titan-embed-text-v2:0";
      const label = entry ? `${entry.name} (${entry.provider})` : modelId;

      // Texts first, then images, in the order given.
      const inputs: EmbedInput[] = [...texts.map((text) => ({ text })), ...images.map((imagePath) => ({ imagePath }))];
      const vectors = await embedInputs(modelId, inputs, signal);

      // Build a markdown similarity matrix with short text labels; image rows and columns carry the file name.
      const names = images.map((p) => basename(p));
      const key = (i: number) => (i < texts.length ? `${i + 1}` : `${i + 1} ${names[i - texts.length]}`);
      const labels = inputs.map((_, i) => {
        if (i >= texts.length) return `${i + 1}. image: ${names[i - texts.length]}`;
        const t = texts[i];
        return `${i + 1}. ${t.length > 24 ? t.slice(0, 21) + "..." : t}`;
      });
      const header = `| | ${inputs.map((_, i) => key(i)).join(" | ")} |`;
      const divider = `| --- |${inputs.map(() => " --- |").join("")}`;
      const rows = vectors.map((v, i) => {
        const cells = vectors.map((w, j) =>
          i === j ? "1.00" : cosineSimilarity(v, w).toFixed(2)
        );
        return `| **${key(i)}** | ${cells.join(" | ")} |`;
      });

      const counted = [
        texts.length > 0 || images.length === 0 ? `${texts.length} text${texts.length === 1 ? "" : "s"}` : "",
        images.length > 0 ? `${images.length} image${images.length === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(", ");
      const text =
        `**${label}** - cosine similarity (${counted})\n\n` +
        labels.join("\n") +
        `\n\n${header}\n${divider}\n${rows.join("\n")}`;

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return errorResult(err);
    }
  }
);

// MCP prompts: ready-made instructions that call the tools above.
registerPrompts(server);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
