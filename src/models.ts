export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  capabilities: string[];
  maxTokens: number;
}

// Curated registry of popular Bedrock models with their capabilities.
// The server also supports any valid model ID not in this list.
export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  // Anthropic Claude
  "anthropic.claude-opus-4-0-20250514-v1:0": {
    id: "anthropic.claude-opus-4-0-20250514-v1:0",
    name: "Claude Opus 4",
    provider: "Anthropic",
    capabilities: ["text", "vision", "tool_use", "streaming"],
    maxTokens: 32768,
  },
  "anthropic.claude-sonnet-4-20250514-v1:0": {
    id: "anthropic.claude-sonnet-4-20250514-v1:0",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    capabilities: ["text", "vision", "tool_use", "streaming"],
    maxTokens: 16384,
  },
  "us.anthropic.claude-opus-4-6-v1": {
    id: "us.anthropic.claude-opus-4-6-v1",
    name: "Claude Opus 4.6",
    provider: "Anthropic",
    capabilities: ["text", "vision", "tool_use", "streaming"],
    maxTokens: 32768,
  },
  "us.anthropic.claude-sonnet-4-6-v1": {
    id: "us.anthropic.claude-sonnet-4-6-v1",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    capabilities: ["text", "vision", "tool_use", "streaming"],
    maxTokens: 16384,
  },
  "anthropic.claude-3-5-haiku-20241022-v1:0": {
    id: "anthropic.claude-3-5-haiku-20241022-v1:0",
    name: "Claude 3.5 Haiku",
    provider: "Anthropic",
    capabilities: ["text", "vision", "tool_use", "streaming"],
    maxTokens: 8192,
  },

  // Meta Llama
  "meta.llama4-maverick-17b-instruct-v1:0": {
    id: "meta.llama4-maverick-17b-instruct-v1:0",
    name: "Llama 4 Maverick 17B",
    provider: "Meta",
    capabilities: ["text", "vision", "streaming"],
    maxTokens: 8192,
  },
  "meta.llama4-scout-17b-instruct-v1:0": {
    id: "meta.llama4-scout-17b-instruct-v1:0",
    name: "Llama 4 Scout 17B",
    provider: "Meta",
    capabilities: ["text", "vision", "streaming"],
    maxTokens: 8192,
  },
  "meta.llama3-3-70b-instruct-v1:0": {
    id: "meta.llama3-3-70b-instruct-v1:0",
    name: "Llama 3.3 70B Instruct",
    provider: "Meta",
    capabilities: ["text", "tool_use", "streaming"],
    maxTokens: 8192,
  },
  "meta.llama3-1-405b-instruct-v1:0": {
    id: "meta.llama3-1-405b-instruct-v1:0",
    name: "Llama 3.1 405B Instruct",
    provider: "Meta",
    capabilities: ["text", "tool_use", "streaming"],
    maxTokens: 4096,
  },

  // Mistral
  "mistral.mistral-large-2407-v1:0": {
    id: "mistral.mistral-large-2407-v1:0",
    name: "Mistral Large 2",
    provider: "Mistral",
    capabilities: ["text", "tool_use", "streaming"],
    maxTokens: 8192,
  },
  "mistral.mistral-small-2402-v1:0": {
    id: "mistral.mistral-small-2402-v1:0",
    name: "Mistral Small",
    provider: "Mistral",
    capabilities: ["text", "streaming"],
    maxTokens: 8192,
  },
  "mistral.pixtral-large-2502-v1:0": {
    id: "mistral.pixtral-large-2502-v1:0",
    name: "Pixtral Large",
    provider: "Mistral",
    capabilities: ["text", "vision", "streaming"],
    maxTokens: 8192,
  },

  // Amazon Nova
  "amazon.nova-pro-v1:0": {
    id: "amazon.nova-pro-v1:0",
    name: "Nova Pro",
    provider: "Amazon",
    capabilities: ["text", "vision", "tool_use", "streaming"],
    maxTokens: 5120,
  },
  "amazon.nova-lite-v1:0": {
    id: "amazon.nova-lite-v1:0",
    name: "Nova Lite",
    provider: "Amazon",
    capabilities: ["text", "vision", "streaming"],
    maxTokens: 5120,
  },
  "amazon.nova-micro-v1:0": {
    id: "amazon.nova-micro-v1:0",
    name: "Nova Micro",
    provider: "Amazon",
    capabilities: ["text", "streaming"],
    maxTokens: 5120,
  },

  // Cohere
  "cohere.command-r-plus-v1:0": {
    id: "cohere.command-r-plus-v1:0",
    name: "Command R+",
    provider: "Cohere",
    capabilities: ["text", "tool_use", "streaming"],
    maxTokens: 4096,
  },
  "cohere.command-r-v1:0": {
    id: "cohere.command-r-v1:0",
    name: "Command R",
    provider: "Cohere",
    capabilities: ["text", "tool_use", "streaming"],
    maxTokens: 4096,
  },

  // AI21
  "ai21.jamba-1-5-large-v1:0": {
    id: "ai21.jamba-1-5-large-v1:0",
    name: "Jamba 1.5 Large",
    provider: "AI21",
    capabilities: ["text", "streaming"],
    maxTokens: 4096,
  },

  // DeepSeek
  "deepseek.r1-v1:0": {
    id: "deepseek.r1-v1:0",
    name: "DeepSeek R1",
    provider: "DeepSeek",
    capabilities: ["text", "streaming"],
    maxTokens: 8192,
  },
};

// Short aliases for convenience (e.g. "llama4" instead of full model ID)
export const MODEL_ALIASES: Record<string, string> = {
  "claude-opus": "anthropic.claude-opus-4-0-20250514-v1:0",
  "claude-sonnet": "anthropic.claude-sonnet-4-20250514-v1:0",
  "claude-opus-4.6": "us.anthropic.claude-opus-4-6-v1",
  "claude-sonnet-4.6": "us.anthropic.claude-sonnet-4-6-v1",
  "claude-haiku": "anthropic.claude-3-5-haiku-20241022-v1:0",
  "llama4-maverick": "meta.llama4-maverick-17b-instruct-v1:0",
  "llama4-scout": "meta.llama4-scout-17b-instruct-v1:0",
  "llama4": "meta.llama4-maverick-17b-instruct-v1:0",
  "llama3.3": "meta.llama3-3-70b-instruct-v1:0",
  "llama3.1-405b": "meta.llama3-1-405b-instruct-v1:0",
  "mistral-large": "mistral.mistral-large-2407-v1:0",
  "mistral-small": "mistral.mistral-small-2402-v1:0",
  "pixtral": "mistral.pixtral-large-2502-v1:0",
  "nova-pro": "amazon.nova-pro-v1:0",
  "nova-lite": "amazon.nova-lite-v1:0",
  "nova-micro": "amazon.nova-micro-v1:0",
  "command-r-plus": "cohere.command-r-plus-v1:0",
  "command-r": "cohere.command-r-v1:0",
  "jamba": "ai21.jamba-1-5-large-v1:0",
  "deepseek": "deepseek.r1-v1:0",
  "deepseek-r1": "deepseek.r1-v1:0",
};

export function resolveModelId(input: string): string {
  // Check aliases first (case-insensitive)
  const lower = input.toLowerCase();
  if (lower in MODEL_ALIASES) {
    return MODEL_ALIASES[lower];
  }
  // If it looks like a full model ID, use it directly
  return input;
}

export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_REGISTRY[modelId];
}
