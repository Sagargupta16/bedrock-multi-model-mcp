import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LEVEL_IDS } from "./panel.js";

export const PROMPT_NAMES = ["second-opinion", "compare-models", "panel-discussion"] as const;

function userMessage(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "second-opinion",
    {
      title: "Second opinion",
      description: "Ask another model the same question and report where it agrees and disagrees.",
      argsSchema: {
        question: z.string().describe("The question to put to the second model"),
        model: z.string().optional().describe("Model alias (default gpt-astra)"),
      },
    },
    ({ question, model }) => {
      const alias = model?.trim() || "gpt-astra";
      return userMessage(
        `Call the bedrock_ask tool with model "${alias}" and this question: "${question}". ` +
          `Include the relevant context from our conversation in the prompt so the second model has what it needs. ` +
          `Then report where the second model agrees with you, where it disagrees, and which points change the answer. ` +
          `Do not hide disagreement.`,
      );
    },
  );

  server.registerPrompt(
    "compare-models",
    {
      title: "Compare models",
      description: "Send one question to several models and summarize how their answers differ.",
      argsSchema: {
        question: z.string().describe("The question to send to every model"),
        models: z.string().optional().describe("Comma-separated model aliases"),
      },
    },
    ({ question, models }) => {
      const list = models?.trim();
      const pick = list
        ? `Call the bedrock_compare tool with the models "${list}"`
        : `No models were given, so call bedrock_list_models, pick 3 models from different providers, and call the bedrock_compare tool with them`;
      return userMessage(
        `${pick} and this question: "${question}". ` +
          `Then summarize the differences between the answers in a short table. ` +
          `If the user wants a winner, use the bedrock_judge tool instead.`,
      );
    },
  );

  server.registerPrompt(
    "panel-discussion",
    {
      title: "Panel discussion",
      description: "Have several models discuss a question in turn and summarize the outcome.",
      argsSchema: {
        question: z.string().describe("The question for the panel to discuss"),
        level: z.string().optional().describe(`Panel level: ${LEVEL_IDS.join(", ")} (default medium)`),
      },
    },
    ({ question, level }) => {
      const lvl = level?.trim() || "medium";
      return userMessage(
        `Call the bedrock_panel tool with level "${lvl}" and this question: "${question}". ` +
          `Then give the points of agreement, the open disagreements, and a recommendation.`,
      );
    },
  );
}
