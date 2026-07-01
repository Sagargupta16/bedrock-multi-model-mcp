import {
  StartAsyncInvokeCommand,
  GetAsyncInvokeCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import { VideoModelSchema, type VideoModel } from "../types.js";
import { bearerToken, bedrockFetch, getClient } from "./client.js";

// Video model catalog loaded and validated from src/data/video-models.json.
// All video models are invoked asynchronously via StartAsyncInvoke with S3
// output, but each provider has its own modelInput shape.
const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const raw = readFileSync(join(dataDir, "video-models.json"), "utf-8");
export const VIDEO_MODELS: VideoModel[] = z
  .array(VideoModelSchema)
  .parse(JSON.parse(raw));

// alias -> model
const VIDEO_ALIASES: Record<string, VideoModel> = Object.fromEntries(
  VIDEO_MODELS.flatMap((m) => m.aliases.map((a) => [a.toLowerCase(), m])),
);

export function getVideoModel(alias: string): VideoModel | undefined {
  return VIDEO_ALIASES[alias.toLowerCase()];
}

const DEFAULT_VIDEO_MODEL = "luma-ray";

export interface VideoOptions {
  model?: string;
  prompt: string;
  s3Uri: string;
  durationSeconds?: number;
}

export interface VideoStartResult {
  modelId: string;
  modelName: string;
  invocationArn: string;
  s3Uri: string;
  durationSeconds: number;
  region?: string;
}

export interface VideoStatusResult {
  invocationArn: string;
  status: string;
  s3Uri?: string;
  submitTime?: string;
  endTime?: string;
}

// Luma Ray 2 supports only 5s or 9s durations, expressed as strings.
function buildLumaRayInput(options: VideoOptions, duration: number): Record<string, unknown> {
  return {
    prompt: options.prompt,
    aspect_ratio: "16:9",
    duration: duration >= 9 ? "9s" : "5s",
    resolution: "720p",
    loop: false,
  };
}

export async function startVideoGeneration(options: VideoOptions): Promise<VideoStartResult> {
  const entry = getVideoModel(options.model ?? DEFAULT_VIDEO_MODEL);
  if (!entry && options.model) {
    const known = VIDEO_MODELS.flatMap((m) => m.aliases).join(", ");
    throw new Error(`Unknown video model "${options.model}". Available: ${known}`);
  }
  const model = entry ?? VIDEO_MODELS[0];
  const duration = options.durationSeconds ?? 5;
  const modelInput = buildLumaRayInput(options, duration);
  const effectiveDuration = duration >= 9 ? 9 : 5;

  try {
    const command = new StartAsyncInvokeCommand({
      modelId: model.id,
      modelInput: modelInput as unknown as DocumentType,
      outputDataConfig: {
        s3OutputDataConfig: { s3Uri: options.s3Uri },
      },
    });
    const response = await getClient(model.region).send(command);
    return {
      modelId: model.id,
      modelName: model.name,
      invocationArn: response.invocationArn ?? "",
      s3Uri: options.s3Uri,
      durationSeconds: effectiveDuration,
      region: model.region,
    };
  } catch (sdkErr) {
    if (!bearerToken) throw sdkErr;

    const json = (await bedrockFetch(
      "async-invoke",
      {
        method: "POST",
        body: JSON.stringify({
          modelId: model.id,
          modelInput,
          outputDataConfig: {
            s3OutputDataConfig: { s3Uri: options.s3Uri },
          },
        }),
      },
      model.region,
    )) as { invocationArn?: string };
    return {
      modelId: model.id,
      modelName: model.name,
      invocationArn: json.invocationArn ?? "",
      s3Uri: options.s3Uri,
      durationSeconds: effectiveDuration,
      region: model.region,
    };
  }
}

export async function getVideoStatus(
  invocationArn: string,
  region?: string,
): Promise<VideoStatusResult> {
  // The ARN embeds its region (arn:aws:bedrock:REGION:...), so callers don't
  // have to remember which region the job was started in. Validate it against
  // the AWS region charset: the bearer-token fallback interpolates the region
  // into the request host, so an unvalidated value (e.g. "us-east-1/@evil.com")
  // could redirect the Authorization: Bearer header to an attacker's server.
  const rawRegion = invocationArn.split(":")[3];
  const arnRegion =
    rawRegion && /^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(rawRegion) ? rawRegion : region;

  try {
    const command = new GetAsyncInvokeCommand({ invocationArn });
    const response = await getClient(arnRegion).send(command);
    return {
      invocationArn,
      status: response.status ?? "Unknown",
      s3Uri: response.outputDataConfig?.s3OutputDataConfig?.s3Uri,
      submitTime: response.submitTime?.toISOString(),
      endTime: response.endTime?.toISOString(),
    };
  } catch (sdkErr) {
    if (!bearerToken) throw sdkErr;

    // Raw HTTP fallback - extract the invocation ID from the ARN
    const parts = invocationArn.split("/");
    const invocationId = parts[parts.length - 1];
    const json = (await bedrockFetch(
      `async-invoke/${encodeURIComponent(invocationId)}`,
      { method: "GET" },
      arnRegion,
    )) as {
      status?: string;
      outputDataConfig?: { s3OutputDataConfig?: { s3Uri?: string } };
      submitTime?: string;
      endTime?: string;
    };
    return {
      invocationArn,
      status: json.status ?? "Unknown",
      s3Uri: json.outputDataConfig?.s3OutputDataConfig?.s3Uri,
      submitTime: json.submitTime,
      endTime: json.endTime,
    };
  }
}
