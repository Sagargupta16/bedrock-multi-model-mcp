import {
  StartAsyncInvokeCommand,
  GetAsyncInvokeCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { indexByAlias, loadRegistry } from "../models.js";
import { VideoModelSchema, type VideoModel } from "../types.js";
import { getClient } from "./client.js";

// Video model catalog loaded and validated from src/data/video-models.json.
// All video models are invoked asynchronously via StartAsyncInvoke with S3
// output, but each provider has its own modelInput shape.
export const VIDEO_MODELS: VideoModel[] = loadRegistry("video-models.json", VideoModelSchema);

// alias -> model
const VIDEO_ALIASES = indexByAlias(VIDEO_MODELS);

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
  // Set by Bedrock when status is "Failed" - without it a failed job reports
  // no reason at all.
  failureMessage?: string;
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

// Takes no abort signal on purpose: cancelling after the request is sent can
// leave a billed job running with no ARN to track it, and the call itself only
// takes a moment.
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
}

export async function getVideoStatus(
  invocationArn: string,
  region?: string,
  signal?: AbortSignal,
): Promise<VideoStatusResult> {
  // The ARN embeds its region (arn:aws:bedrock:REGION:...), so callers don't
  // have to remember which region the job was started in. Validate it against
  // the AWS region charset before it picks the endpoint host, so a crafted ARN
  // (e.g. "us-east-1/@evil.com") cannot point the signed request elsewhere.
  const rawRegion = invocationArn.split(":")[3];
  const arnRegion =
    rawRegion && /^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(rawRegion) ? rawRegion : region;

  const response = await getClient(arnRegion).send(new GetAsyncInvokeCommand({ invocationArn }), {
    abortSignal: signal,
  });
  return {
    invocationArn,
    status: response.status ?? "Unknown",
    s3Uri: response.outputDataConfig?.s3OutputDataConfig?.s3Uri,
    submitTime: response.submitTime?.toISOString(),
    endTime: response.endTime?.toISOString(),
    failureMessage: response.failureMessage,
  };
}
