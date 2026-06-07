import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

// Shared region/auth config and a lazily-constructed SDK client, used by
// every API wrapper (converse, image, video) so credential handling lives
// in one place.

export const region =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

export const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;

let sdkClient: BedrockRuntimeClient | undefined;

export function getClient(): BedrockRuntimeClient {
  sdkClient ??= new BedrockRuntimeClient({ region });
  return sdkClient;
}

// Raw HTTP fallback for bearer-token auth when the SDK doesn't pick the token
// up. Returns the parsed JSON body; throws with the API error text on non-2xx.
export async function bedrockFetch(
  path: string,
  init: { method: string; body?: string },
): Promise<unknown> {
  const url = `https://bedrock-runtime.${region}.amazonaws.com/${path}`;
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
