import {
  ConverseCommand,
  type Message,
  type SystemContentBlock,
  type InferenceConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import { resolveModelId, getModelInfo } from "../models.js";
import { bedrockFetch, getClient, withBearerFallback } from "./client.js";

export interface ConverseOptions {
  modelId: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ConverseResult {
  modelId: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  latencyMs: number;
}

interface ConverseResponse {
  output?: { message?: { role?: string; content?: Array<{ text?: string }> } };
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  metrics?: { latencyMs?: number };
}

export async function converse(options: ConverseOptions): Promise<ConverseResult> {
  const resolvedId = resolveModelId(options.modelId);
  const info = getModelInfo(resolvedId);
  const defaultMax = info?.maxTokens ?? 4096;

  const messages: Message[] = [
    { role: "user", content: [{ text: options.prompt }] },
  ];

  const system: SystemContentBlock[] | undefined = options.system
    ? [{ text: options.system }]
    : undefined;

  const inferenceConfig: InferenceConfiguration = {
    maxTokens: options.maxTokens ?? defaultMax,
  };

  // Some models (e.g. Opus 4.7+) reject the temperature parameter, so omit it.
  if (!info?.noTemperature) {
    inferenceConfig.temperature = options.temperature ?? 0.7;
  }

  const start = Date.now();

  // SDK first (handles IAM and, on SDK >= 3.840.0, the bearer token too); raw
  // HTTP with the bearer token only if the SDK was rejected on auth.
  const parsed = await withBearerFallback<ConverseResponse>(
    async () => {
      const response = await getClient().send(
        new ConverseCommand({ modelId: resolvedId, messages, system, inferenceConfig }),
      );
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
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content?.map((c) => ("text" in c ? { text: c.text } : c)),
        })),
        inferenceConfig,
      };
      if (system) {
        body.system = system.map((s) => ("text" in s ? { text: s.text } : s));
      }
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
  };
}
