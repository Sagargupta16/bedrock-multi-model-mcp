import type { ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { region } from "./client.js";
import type { ModelReply } from "./converse.js";

// Text models Bedrock serves only on its OpenAI-compatible bedrock-mantle
// endpoint (Gemma 4), not through Converse. Called over Chat Completions under
// the /openai/v1 path with the Bedrock API key as a bearer token, which answered
// on 2026-11-01. AWS also accepts SigV4 there; this server does not sign for
// mantle, so these models need AWS_BEARER_TOKEN_BEDROCK.

// Chat Completions finish reasons, mapped to the Converse names the tools print.
const STOP_REASONS: Record<string, string> = { stop: "end_turn", length: "max_tokens" };

// Sends a request built by buildConverseInput (so option checks, the output cap
// and temperature rules are the same as for Converse) to bedrock-mantle.
export async function mantleChat(
  input: ConverseCommandInput & { modelId: string },
  signal?: AbortSignal,
): Promise<ModelReply> {
  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) {
    throw new Error(
      `${input.modelId} is served only on the bedrock-mantle endpoint, which this server calls with a ` +
        "Bedrock API key. Set AWS_BEARER_TOKEN_BEDROCK.",
    );
  }

  const jsonSchema = input.outputConfig?.textFormat?.structure?.jsonSchema;
  const body = {
    model: input.modelId,
    messages: [
      ...(input.system ?? []).map((s) => ({ role: "system", content: s.text ?? "" })),
      ...(input.messages ?? []).map((m) => ({
        role: m.role,
        content: (m.content ?? []).map((c) => c.text ?? "").join(""),
      })),
    ],
    max_tokens: input.inferenceConfig?.maxTokens,
    ...(input.inferenceConfig?.temperature !== undefined && { temperature: input.inferenceConfig.temperature }),
    ...(input.outputConfig?.effort && { reasoning_effort: input.outputConfig.effort }),
    ...(jsonSchema?.schema && {
      response_format: {
        type: "json_schema",
        json_schema: { name: jsonSchema.name, schema: JSON.parse(jsonSchema.schema), strict: true },
      },
    }),
  };

  const response = await fetch(`https://bedrock-mantle.${region}.api.aws/openai/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await response.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(`bedrock-mantle error (${response.status}): ${json.error?.message ?? response.statusText}`);
  }

  const choice = json.choices?.[0];
  const finish = choice?.finish_reason ?? "unknown";
  return {
    text: choice?.message?.content ?? "",
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
    stopReason: STOP_REASONS[finish] ?? finish,
  };
}
