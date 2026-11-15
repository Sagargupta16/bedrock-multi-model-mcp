import { execFileSync } from "node:child_process";

import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

// Shared region/auth config and lazily-constructed SDK clients, used by
// every API wrapper (converse, image, video, embed) so credential handling lives
// in one place. Models live in different regions (Nova in us-east-1,
// Stability/Luma in us-west-2), so clients are cached per region.

export const region =
  process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";

// The value of a variable in the Windows user environment (HKCU\Environment, where
// setx and the System Properties dialog store it), or undefined elsewhere or when it
// is not set. Never logged.
function windowsUserVariable(name: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true,
    });
    const line = out.split(/\r?\n/).find((l) => l.trim().startsWith(`${name} `));
    const value = line?.match(/REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/)?.[1];
    return value || undefined;
  } catch {
    return undefined; // reg exits 1 when the value does not exist
  }
}

// The SDK reads AWS_BEARER_TOKEN_BEDROCK itself and switches to bearer auth
// whenever the variable exists, even when it is empty, and then fails every call
// with "the `token` is not defined". An MCP config that passes
// "${AWS_BEARER_TOKEN_BEDROCK}" expands to "" when the client's own environment
// lacks the variable: the Claude desktop app, for one, does not pass the user's key
// on to the servers it starts. So an empty or missing key is read from the Windows
// user environment first, and only then treated as unset, which lets the standard
// IAM credential chain answer instead.
if (!process.env.AWS_BEARER_TOKEN_BEDROCK?.trim()) {
  const fromUser = windowsUserVariable("AWS_BEARER_TOKEN_BEDROCK");
  if (fromUser) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = fromUser;
  } else {
    delete process.env.AWS_BEARER_TOKEN_BEDROCK;
  }
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
