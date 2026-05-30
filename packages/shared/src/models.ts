export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type SupportedProvider = "anthropic" | "openai" | "openrouter";

export type ReasoningEffortLevel = "none" | "low" | "medium" | "high" | "max";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
  supportsThinking?: boolean;
  contextWindow: number;
};

export const SUPPORTED_CHAT_MODELS = [
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillionTokens: 3,
      outputUsdPerMillionTokens: 15,
    },
    supportsThinking: true,
    contextWindow: 1000000,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 5,
    },
    contextWindow: 200000,
  },
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 25,
    },
    supportsThinking: true,
    contextWindow: 1000000,
  },
  {
    id: "gpt-5.4",
    provider: "openai",
    pricing: {
      inputUsdPerMillionTokens: 2.5,
      outputUsdPerMillionTokens: 15,
    },
    supportsThinking: true,
    contextWindow: 1050000,
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    pricing: {
      inputUsdPerMillionTokens: 0.75,
      outputUsdPerMillionTokens: 4.5,
    },
    supportsThinking: true,
    contextWindow: 400000,
  },
  {
    id: "gpt-5.4-nano",
    provider: "openai",
    pricing: {
      inputUsdPerMillionTokens: 0.2,
      outputUsdPerMillionTokens: 1.25,
    },
    contextWindow: 400000,
  },
  {
    id: "baidu/cobuddy:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
    supportsThinking: true,
    contextWindow: 131072,
  },
  {
    id: "poolside/laguna-xs.2:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
    supportsThinking: true,
    contextWindow: 131072,
  },
  {
    id: "poolside/laguna-m.1:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
    supportsThinking: true,
    contextWindow: 131072,
  },
  {
    id: "openrouter/owl-alpha",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
    contextWindow: 1048576,
  },
  {
    id: "deepseek/deepseek-v4-flash:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
    supportsThinking: true,
    contextWindow: 1048576,
  },
  {
    id: "arcee-ai/trinity-large-thinking:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
    supportsThinking: true,
    contextWindow: 262144,
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
    supportsThinking: true,
    contextWindow: 1000000,
  },
  {
    id: "openai/gpt-oss-120b:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
    supportsThinking: true,
    contextWindow: 131072,
  },
  {
    id: "z-ai/glm-4.5-air:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
    supportsThinking: true,
    contextWindow: 131072,
  },
  {
    id: "moonshotai/kimi-k2.6",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 4,
    },
    supportsThinking: true,
    contextWindow: 262144,
  },
  {
    id: "z-ai/glm-5.1",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0.9,
      outputUsdPerMillionTokens: 4.5,
    },
    supportsThinking: true,
    contextWindow: 202752,
  },
  {
    id: "xiaomi/mimo-v2.5-pro",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 3.2,
    },
    supportsThinking: true,
    contextWindow: 1000000,
  },
  {
    id: "minimax/minimax-m2.7",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0.5,
      outputUsdPerMillionTokens: 2.5,
    },
    supportsThinking: true,
    contextWindow: 204800,
  },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number] &
  SupportedChatModelDefinition;
export type SupportedChatModelId = (typeof SUPPORTED_CHAT_MODELS)[number]["id"];

export function findSupportedChatModel(
  modelId: string,
): SupportedChatModel | undefined {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId) as
    | SupportedChatModel
    | undefined;
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId =
  "z-ai/glm-4.5-air:free";
