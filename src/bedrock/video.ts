import {
  StartAsyncInvokeCommand,
  GetAsyncInvokeCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { bearerToken, bedrockFetch, getClient } from "./client.js";

// amazon.nova-reel-v1:1 is the current Bedrock text-to-video model, invoked
// asynchronously via StartAsyncInvoke with S3 output.
const VIDEO_MODEL_ID = "amazon.nova-reel-v1:1";

export interface VideoOptions {
  prompt: string;
  s3Uri: string;
  durationSeconds?: number;
  seed?: number;
}

export interface VideoStartResult {
  invocationArn: string;
  s3Uri: string;
  durationSeconds: number;
}

export interface VideoStatusResult {
  invocationArn: string;
  status: string;
  s3Uri?: string;
  submitTime?: string;
  endTime?: string;
}

export async function startVideoGeneration(options: VideoOptions): Promise<VideoStartResult> {
  const duration = options.durationSeconds ?? 6;
  const isMultiShot = duration > 6;

  const modelInput = isMultiShot
    ? {
        taskType: "MULTI_SHOT_AUTOMATED",
        multiShotAutomatedParams: { text: options.prompt },
        videoGenerationConfig: {
          durationSeconds: duration,
          fps: 24,
          dimension: "1280x720",
          seed: options.seed ?? 42,
        },
      }
    : {
        taskType: "TEXT_VIDEO",
        textToVideoParams: { text: options.prompt },
        videoGenerationConfig: {
          durationSeconds: 6,
          fps: 24,
          dimension: "1280x720",
          seed: options.seed ?? 42,
        },
      };

  try {
    const command = new StartAsyncInvokeCommand({
      modelId: VIDEO_MODEL_ID,
      modelInput: modelInput as unknown as DocumentType,
      outputDataConfig: {
        s3OutputDataConfig: { s3Uri: options.s3Uri },
      },
    });
    const response = await getClient().send(command);
    return {
      invocationArn: response.invocationArn ?? "",
      s3Uri: options.s3Uri,
      durationSeconds: duration,
    };
  } catch (sdkErr) {
    if (!bearerToken) throw sdkErr;

    const json = (await bedrockFetch("async-invoke", {
      method: "POST",
      body: JSON.stringify({
        modelId: VIDEO_MODEL_ID,
        modelInput,
        outputDataConfig: {
          s3OutputDataConfig: { s3Uri: options.s3Uri },
        },
      }),
    })) as { invocationArn?: string };
    return {
      invocationArn: json.invocationArn ?? "",
      s3Uri: options.s3Uri,
      durationSeconds: duration,
    };
  }
}

export async function getVideoStatus(invocationArn: string): Promise<VideoStatusResult> {
  try {
    const command = new GetAsyncInvokeCommand({ invocationArn });
    const response = await getClient().send(command);
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
    const json = (await bedrockFetch(`async-invoke/${invocationId}`, {
      method: "GET",
    })) as {
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
