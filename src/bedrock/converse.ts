import {
  ConverseCommand,
  type ConverseCommandInput,
  type Message,
  type SystemContentBlock,
  type InferenceConfiguration,
  type OutputConfig,
} from "@aws-sdk/client-bedrock-runtime";
import { resolveModelId, getModelInfo, TEXT_MODELS } from "../models.js";
import type { EffortLevel } from "../types.js";
import { bedrockFetch, getClient, withBearerFallback } from "./client.js";

export interface ConverseOptions {
  modelId: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  effort?: EffortLevel;
  // JSON schema the reply must match (Converse outputConfig.textFormat).
  schema?: Record<string, unknown>;
  schemaName?: string;
}

export interface ConverseResult {
  modelId: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  latencyMs: number;
  // Parsed reply, set when a schema was sent and the reply held valid JSON.
  json?: unknown;
}

interface ConverseResponse {
  output?: { message?: { role?: string; content?: Array<{ text?: string }> } };
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  metrics?: { latencyMs?: number };
}

function supportedBy(flag: (m: (typeof TEXT_MODELS)[number]) => boolean): string {
  return TEXT_MODELS.filter(flag).map((m) => m.name).join(", ");
}

// Effort for one model of a multi-model call (compare, judge): kept for models
// that take it and for ids outside the registry, dropped for the rest, so one
// effort value can tune the Claude candidates without failing a Nova or Llama one.
export function effortFor(modelId: string, effort?: EffortLevel): EffortLevel | undefined {
  if (!effort) return undefined;
  const info = getModelInfo(resolveModelId(modelId));
  return !info || info.effort ? effort : undefined;
}

// Builds the Converse input and rejects options a known model does not take,
// before a billed call. Unknown model ids pass through for Bedrock to judge.
export function buildConverseInput(options: ConverseOptions): ConverseCommandInput & { modelId: string } {
  const resolvedId = resolveModelId(options.modelId);
  const info = getModelInfo(resolvedId);

  if (options.effort && info && !info.effort) {
    throw new Error(
      `${info.name} does not take effort. Models that do: ${supportedBy((m) => !!m.effort)}.`,
    );
  }
  if (options.schema && info && !info.capabilities.includes("structured_output")) {
    throw new Error(
      `${info.name} does not support structured output. Models that do: ` +
        `${supportedBy((m) => m.capabilities.includes("structured_output"))}.`,
    );
  }

  const messages: Message[] = [
    { role: "user", content: [{ text: options.prompt }] },
  ];

  const system: SystemContentBlock[] | undefined = options.system
    ? [{ text: options.system }]
    : undefined;

  const inferenceConfig: InferenceConfiguration = {
    maxTokens: options.maxTokens ?? info?.maxTokens ?? 4096,
  };

  // Some models (e.g. Opus 4.7+) reject the temperature parameter, so omit it.
  if (!info?.noTemperature) {
    inferenceConfig.temperature = options.temperature ?? 0.7;
  }

  let outputConfig: OutputConfig | undefined;
  if (options.effort || options.schema) {
    outputConfig = {};
    if (options.effort) outputConfig.effort = options.effort;
    if (options.schema) {
      outputConfig.textFormat = {
        type: "json_schema",
        structure: {
          jsonSchema: {
            // Converse takes the schema as a JSON string, not an object.
            schema: JSON.stringify(options.schema),
            name: options.schemaName ?? "response",
          },
        },
      };
    }
  }

  return { modelId: resolvedId, messages, system, inferenceConfig, outputConfig };
}

// Reads the JSON a schema-constrained reply carries. GPT-OSS on Bedrock puts a
// stray character before the object (seen 2026-10-21: `B{"city":...}`), so on a
// failed parse retry from the first brace or bracket.
export function parseJsonReply(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[{[]/);
    if (start <= 0) return undefined;
    try {
      return JSON.parse(text.slice(start));
    } catch {
      return undefined;
    }
  }
}

export async function converse(options: ConverseOptions): Promise<ConverseResult> {
  const input = buildConverseInput(options);
  const { modelId: resolvedId, messages, system, inferenceConfig, outputConfig } = input;

  const start = Date.now();

  // SDK first (handles IAM and, on SDK >= 3.840.0, the bearer token too); raw
  // HTTP with the bearer token only if the SDK was rejected on auth.
  const parsed = await withBearerFallback<ConverseResponse>(
    async () => {
      const response = await getClient().send(new ConverseCommand(input));
      return {
        output: {
          message: {
            content: response.output?.message?.content?.map((b) => ({
              text: "text" in b ? b.text : "",
            })),
          },
        },
        stopReason: response.stopReason,
        usage: response.usage,
      };
    },
    async () => {
      const body: Record<string, unknown> = {
        messages: messages!.map((m) => ({
          role: m.role,
          content: m.content?.map((c) => ("text" in c ? { text: c.text } : c)),
        })),
        inferenceConfig,
      };
      if (system) {
        body.system = system.map((s) => ("text" in s ? { text: s.text } : s));
      }
      if (outputConfig) body.outputConfig = outputConfig;
      return (await bedrockFetch(
        `model/${encodeURIComponent(resolvedId)}/converse`,
        { method: "POST", body: JSON.stringify(body) },
      )) as ConverseResponse;
    },
  );

  const text = parsed.output?.message?.content?.map((b) => b.text ?? "").join("") ?? "";
  const inputTokens = parsed.usage?.inputTokens ?? 0;
  const outputTokens = parsed.usage?.outputTokens ?? 0;
  const stopReason = parsed.stopReason ?? "unknown";

  return {
    modelId: resolvedId,
    text,
    inputTokens,
    outputTokens,
    stopReason,
    latencyMs: Date.now() - start,
    json: options.schema ? parseJsonReply(text) : undefined,
  };
}
