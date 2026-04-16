import {
  BedrockRuntimeClient,
  StartAsyncInvokeCommand,
  GetAsyncInvokeCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";

const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
const bearerToken = process.env.AWS_BEARER_TOKEN_BEDROCK;

let sdkClient: BedrockRuntimeClient | undefined;

function getClient(): BedrockRuntimeClient {
  sdkClient ??= new BedrockRuntimeClient({ region });
  return sdkClient;
}

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
      modelId: "amazon.nova-reel-v1:1",
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

    // Raw HTTP fallback
    const url = `https://bedrock-runtime.${region}.amazonaws.com/async-invoke`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        modelId: "amazon.nova-reel-v1:1",
        modelInput,
        outputDataConfig: {
          s3OutputDataConfig: { s3Uri: options.s3Uri },
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bedrock API error (${response.status}): ${text}`);
    }
    const json = (await response.json()) as { invocationArn?: string };
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

    // Raw HTTP fallback - extract the invocation ID from ARN
    const parts = invocationArn.split("/");
    const invocationId = parts[parts.length - 1];
    const url = `https://bedrock-runtime.${region}.amazonaws.com/async-invoke/${invocationId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Bedrock API error (${response.status}): ${text}`);
    }
    const json = (await response.json()) as {
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
