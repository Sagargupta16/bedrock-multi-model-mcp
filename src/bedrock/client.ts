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

// SDK errors that mean the request was rejected before Bedrock did any work:
// no credentials resolved, a bad or expired signature or token, or an identity
// without access. Retrying those with the bearer token is safe. Anything else
// (throttling, timeouts, 5xx, validation) is NOT retried, because the first
// request may already have run and been billed - a retried StartAsyncInvoke
// would start a second video job.
const AUTH_ERROR_NAMES = new Set([
  "CredentialsProviderError",
  "TokenProviderError",
  "UnrecognizedClientException",
  "InvalidSignatureException",
  "IncompleteSignatureException",
  "MissingAuthenticationTokenException",
  "ExpiredTokenException",
  "AccessDeniedException",
]);

export function isAuthError(err: unknown): boolean {
  return err instanceof Error && AUTH_ERROR_NAMES.has(err.name);
}

// Run the SDK call; on an auth error, and only when a bearer token is set,
// retry once over raw HTTP. If the retry fails too, the thrown error carries
// both messages, so the SDK's reason is not lost behind the HTTP one.
export async function withBearerFallback<T>(
  sdkCall: () => Promise<T>,
  httpCall: () => Promise<T>,
  token: string | undefined = bearerToken,
): Promise<T> {
  try {
    return await sdkCall();
  } catch (sdkErr) {
    if (!token || !isAuthError(sdkErr)) throw sdkErr;
    try {
      return await httpCall();
    } catch (httpErr) {
      const sdkMsg = (sdkErr as Error).message;
      const httpMsg = httpErr instanceof Error ? httpErr.message : String(httpErr);
      throw new Error(`${httpMsg} (after SDK ${(sdkErr as Error).name}: ${sdkMsg})`, {
        cause: sdkErr,
      });
    }
  }
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
