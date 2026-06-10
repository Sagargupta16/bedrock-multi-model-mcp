import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

// Shared region/auth config and lazily-constructed SDK clients, used by
// every API wrapper (converse, image, video) so credential handling lives
// in one place. Models live in different regions (Nova in us-east-1,
// Stability/Luma in us-west-2), so clients are cached per region.

export const region =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

export const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;

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

// Raw HTTP fallback for bearer-token auth when the SDK doesn't pick the token
// up. Returns the parsed JSON body; throws with the API error text on non-2xx.
export async function bedrockFetch(
  path: string,
  init: { method: string; body?: string },
  modelRegion?: string,
): Promise<unknown> {
  const r = modelRegion ?? region;
  const url = `https://bedrock-runtime.${r}.amazonaws.com/${path}`;
  const response = await fetch(url, {
    method: init.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bearerToken}`,
    },
    body: init.body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Bedrock API error (${response.status}): ${text}`);
  }
  return response.json();
}
