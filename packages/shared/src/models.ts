export type ModelPricing = {
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
};

export type SupportedProvider = "anthropic" | "openai" | "openrouter";

type SupportedChatModelDefinition = {
  id: string;
  provider: SupportedProvider;
  pricing: ModelPricing;
};

export const SUPPORTED_CHAT_MODELS = [
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillionTokens: 3,
      outputUsdPerMillionTokens: 15,
    },
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 5,
    },
  },
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 25,
    },
  },
  {
    id: "gpt-5.4",
    provider: "openai",
    pricing: {
      inputUsdPerMillionTokens: 2.5,
      outputUsdPerMillionTokens: 15,
    },
  },
  {
    id: "gpt-5.4-mini",
    provider: "openai",
    pricing: {
      inputUsdPerMillionTokens: 0.75,
      outputUsdPerMillionTokens: 4.5,
    },
  },
  {
    id: "gpt-5.4-nano",
    provider: "openai",
    pricing: {
      inputUsdPerMillionTokens: 0.2,
      outputUsdPerMillionTokens: 1.25,
    },
  },
  {
    id: "baidu/cobuddy:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
  },
  {
    id: "poolside/laguna-xs.2:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
  },
  {
    id: "poolside/laguna-m.1:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
  },
  {
    id: "openrouter/owl-alpha",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
  },
  {
    id: "deepseek/deepseek-v4-flash:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
  },
  {
    id: "arcee-ai/trinity-large-thinking:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
  },
  {
    id: "openai/gpt-oss-120b:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
  },
  {
    id: "z-ai/glm-4.5-air:free",
    provider: "openrouter",
    pricing: {
      inputUsdPerMillionTokens: 0,
      outputUsdPerMillionTokens: 0,
    },
  },
] as const satisfies readonly SupportedChatModelDefinition[];

export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
export type SupportedChatModelId = SupportedChatModel["id"];

export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId =
  "z-ai/glm-4.5-air:free";
