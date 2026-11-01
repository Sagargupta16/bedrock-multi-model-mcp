import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

// Shared region/auth config and lazily-constructed SDK clients, used by
// every API wrapper (converse, image, video, embed) so credential handling lives
// in one place. Models live in different regions (Nova in us-east-1,
// Stability/Luma in us-west-2), so clients are cached per region.

export const region =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

// The SDK reads AWS_BEARER_TOKEN_BEDROCK itself and switches to bearer auth
// whenever the variable exists, even when it is empty, and then fails every call
// with "the `token` is not defined". An MCP config that passes
// "${AWS_BEARER_TOKEN_BEDROCK}" expands to "" when the client's own environment
// lacks the variable, so treat an empty value as unset and let the standard IAM
// credential chain answer instead.
if (process.env.AWS_BEARER_TOKEN_BEDROCK?.trim() === "") {
  delete process.env.AWS_BEARER_TOKEN_BEDROCK;
}

const sdkClients = new Map<string, BedrockRuntimeClient>();

export function getClient(modelRegion?: string): BedrockRuntimeClient {
  const r = modelRegion ?? region;
  let client = sdkClients.get(r);
  if (!client) {
    client = new BedrockRuntimeClient({ region: r });
    sdkClients.set(r, client);
  }
  return client;
}
