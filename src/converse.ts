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

let client: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
    client = new BedrockRuntimeClient({ region });
  }
  return client;
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
    temperature: options.temperature ?? 0.7,
  };

  const start = Date.now();

  const command = new ConverseCommand({
    modelId: resolvedId,
    messages,
    system,
    inferenceConfig,
  });

  const response = await getClient().send(command);
  const latencyMs = Date.now() - start;

  const outputContent = response.output?.message?.content;
  const text = outputContent
    ?.map((block) => ("text" in block ? block.text : ""))
    .join("")
    ?? "";

  return {
    modelId: resolvedId,
    text,
    inputTokens: response.usage?.inputTokens ?? 0,
    outputTokens: response.usage?.outputTokens ?? 0,
    stopReason: response.stopReason ?? "unknown",
    latencyMs,
  };
}
