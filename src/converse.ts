import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type SystemContentBlock,
  type InferenceConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import { resolveModelId, getModelInfo } from "./models.js";

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

let sdkClient: BedrockRuntimeClient | undefined;

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;

function getSdkClient(): BedrockRuntimeClient {
  sdkClient ??= new BedrockRuntimeClient({ region });
  return sdkClient;
}

// Raw HTTP fallback for bearer token auth if the SDK doesn't pick it up.
async function converseViaHttp(
  modelId: string,
  body: Record<string, unknown>,
): Promise<ConverseResponse> {
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bedrock API error (${response.status}): ${text}`);
  }
  return (await response.json()) as ConverseResponse;
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

  // Some models (e.g. Opus 4.7) reject the temperature parameter
  if (!info?.noTemperature) {
    inferenceConfig.temperature = options.temperature ?? 0.7;
  } else if (options.temperature !== undefined) {
    // User explicitly set temperature — warn but still omit
    // (model will reject it regardless)
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
    const response = await getSdkClient().send(command);

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

    const response = await converseViaHttp(resolvedId, body);
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
