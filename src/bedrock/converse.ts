import {
  ConverseCommand,
  type Message,
  type SystemContentBlock,
  type InferenceConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import { resolveModelId, getModelInfo } from "../models.js";
import { bearerToken, bedrockFetch, getClient } from "./client.js";

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
  let text: string;
  let inputTokens: number;
  let outputTokens: number;
  let stopReason: string;

  try {
    // Try AWS SDK first (handles both IAM and bearer token via env var)
    const command = new ConverseCommand({
      modelId: resolvedId,
      messages,
      system,
      inferenceConfig,
    });
    const response = await getClient().send(command);

    const outputContent = response.output?.message?.content;
    text = outputContent?.map((b) => ("text" in b ? b.text : "")).join("") ?? "";
    inputTokens = response.usage?.inputTokens ?? 0;
    outputTokens = response.usage?.outputTokens ?? 0;
    stopReason = response.stopReason ?? "unknown";
  } catch (sdkErr) {
    // If SDK fails and we have a bearer token, fall back to raw HTTP
    if (!bearerToken) throw sdkErr;

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

    const response = (await bedrockFetch(
      `model/${encodeURIComponent(resolvedId)}/converse`,
      { method: "POST", body: JSON.stringify(body) },
    )) as ConverseResponse;

    const outputContent = response.output?.message?.content;
    text = outputContent?.map((b) => b.text ?? "").join("") ?? "";
    inputTokens = response.usage?.inputTokens ?? 0;
    outputTokens = response.usage?.outputTokens ?? 0;
    stopReason = response.stopReason ?? "unknown";
  }

  return {
    modelId: resolvedId,
    text,
    inputTokens,
    outputTokens,
    stopReason,
    latencyMs: Date.now() - start,
  };
}
