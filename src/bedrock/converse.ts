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
import { getClient } from "./client.js";
import { mantleChat } from "./mantle.js";

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
  // Aborts the request when the MCP client cancels the tool call.
  signal?: AbortSignal;
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

// What either text API (Converse or bedrock-mantle) returns for one call.
export type ModelReply = Pick<ConverseResult, "text" | "inputTokens" | "outputTokens" | "stopReason">;

function supportedBy(flag: (m: (typeof TEXT_MODELS)[number]) => boolean): string {
  return TEXT_MODELS.filter(flag).map((m) => m.name).join(", ");
}

// Effort for one model of a multi-model call (compare, judge): kept for models
// that take it and for ids outside the registry, dropped for the rest, so one
// effort value can tune the Claude candidates without failing a Nova or Mistral one.
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
  const start = Date.now();

  const reply =
    getModelInfo(input.modelId)?.api === "mantle"
      ? await mantleChat(input, options.signal)
      : await converseRuntime(input, options.signal);

  return {
    modelId: input.modelId,
    ...reply,
    latencyMs: Date.now() - start,
    json: options.schema ? parseJsonReply(reply.text) : undefined,
  };
}

// The SDK handles both IAM credentials and the bearer token (it reads
// AWS_BEARER_TOKEN_BEDROCK natively).
async function converseRuntime(
  input: ConverseCommandInput,
  signal?: AbortSignal,
): Promise<ModelReply> {
  const response = await getClient().send(new ConverseCommand(input), { abortSignal: signal });
  return {
    text: response.output?.message?.content?.map((b) => b.text ?? "").join("") ?? "",
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0,
    stopReason: response.stopReason ?? "unknown",
  };
}
