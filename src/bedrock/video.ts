import {
  StartAsyncInvokeCommand,
  GetAsyncInvokeCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { indexByAlias, loadRegistry } from "../models.js";
import { VideoModelSchema, type VideoModel } from "../types.js";
import { getClient } from "./client.js";
import { readImageFile } from "./edit.js";
import { readPngSize } from "./image.js";

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
  // Local JPEG or PNG files used as the first and last frame (Luma Ray 2).
  startImagePath?: string;
  endImagePath?: string;
}

export interface VideoStartResult {
  modelId: string;
  modelName: string;
  invocationArn: string;
  s3Uri: string;
  durationSeconds: number;
  region?: string;
  // Which keyframes were sent, when any were.
  keyframes?: Array<"start" | "end">;
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

export interface KeyframeImage {
  mediaType: "image/jpeg" | "image/png";
  base64: string;
}

// Luma Ray 2 supports only 5s or 9s durations, expressed as strings.
// Image-to-video: keyframes.frame0 is the start image, frame1 the end image.
// https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-luma.html
export function buildLumaRayInput(
  options: VideoOptions,
  duration: number,
  frames?: { start?: KeyframeImage; end?: KeyframeImage },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    prompt: options.prompt,
    aspect_ratio: "16:9",
    duration: duration >= 9 ? "9s" : "5s",
    resolution: "720p",
    loop: false,
  };
  const frame = (image: KeyframeImage) => ({
    type: "image",
    source: { type: "base64", media_type: image.mediaType, data: image.base64 },
  });
  const keyframes: Record<string, unknown> = {};
  if (frames?.start) keyframes.frame0 = frame(frames.start);
  if (frames?.end) keyframes.frame1 = frame(frames.end);
  if (Object.keys(keyframes).length > 0) body.keyframes = keyframes;
  return body;
}

// Luma Ray 2 image limits from the page above: JPEG or PNG, at least 512x512
// and at most 4096x4096 pixels. The page states no file size limit.
const KEYFRAME_MIN_PX = 512;
const KEYFRAME_MAX_PX = 4096;

// Width and height from the first SOF marker of a JPEG, or undefined.
export function readJpegSize(jpeg: Buffer): { width: number; height: number } | undefined {
  let i = 2;
  while (i + 9 < jpeg.length) {
    if (jpeg[i] !== 0xff) return undefined;
    const marker = jpeg[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // SOF0-SOF15 except DHT (c4), JPG (c8) and DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: jpeg.readUInt16BE(i + 5), width: jpeg.readUInt16BE(i + 7) };
    }
    i += 2 + jpeg.readUInt16BE(i + 2);
  }
  return undefined;
}

// Reads and checks a keyframe file before the billed call is sent.
export async function readKeyframeImage(path: string, label: string): Promise<KeyframeImage> {
  const { full, bytes, mediaType } = await readImageFile(path);
  if (mediaType === "image/webp") {
    throw new Error(`${label} image ${full} is WebP; Luma Ray 2 takes JPEG or PNG only`);
  }
  const size = mediaType === "image/png" ? readPngSize(bytes) : readJpegSize(bytes);
  if (!size) throw new Error(`${label} image ${full}: could not read the image dimensions`);
  if (size.width < KEYFRAME_MIN_PX || size.height < KEYFRAME_MIN_PX) {
    throw new Error(
      `${label} image ${full} is ${size.width}x${size.height}; Luma Ray 2 needs at least ${KEYFRAME_MIN_PX}x${KEYFRAME_MIN_PX} pixels`,
    );
  }
  if (size.width > KEYFRAME_MAX_PX || size.height > KEYFRAME_MAX_PX) {
    throw new Error(
      `${label} image ${full} is ${size.width}x${size.height}; Luma Ray 2 allows at most ${KEYFRAME_MAX_PX}x${KEYFRAME_MAX_PX} pixels`,
    );
  }
  return { mediaType, base64: bytes.toString("base64") };
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
  // Read and validate the images before the send, so a bad path never reaches
  // the billed call.
  const frames: { start?: KeyframeImage; end?: KeyframeImage } = {};
  if (options.startImagePath) frames.start = await readKeyframeImage(options.startImagePath, "Start");
  if (options.endImagePath) frames.end = await readKeyframeImage(options.endImagePath, "End");
  const modelInput = buildLumaRayInput(options, duration, frames);
  const keyframes: Array<"start" | "end"> = [];
  if (frames.start) keyframes.push("start");
  if (frames.end) keyframes.push("end");
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
    ...(keyframes.length > 0 ? { keyframes } : {}),
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
