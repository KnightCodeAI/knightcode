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
    id: "anthropic/claude-opus-4.8",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 25,
    },
    supportsThinking: true,
    contextWindow: 1000000,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillionTokens: 3,
      outputUsdPerMillionTokens: 15,
    },
    supportsThinking: true,
    contextWindow: 1000000,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    provider: "anthropic",
    pricing: {
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 5,
    },
    supportsThinking: true,
    contextWindow: 200000,
  },
  {
    id: "openai/gpt-5.5-pro",
    provider: "openai",
    pricing: {
      inputUsdPerMillionTokens: 30,
      outputUsdPerMillionTokens: 180,
    },
    supportsThinking: true,
    contextWindow: 1050000,
  },
  {
    id: "openai/gpt-5.5",
    provider: "openai",
    pricing: {
      inputUsdPerMillionTokens: 5,
      outputUsdPerMillionTokens: 30,
    },
    supportsThinking: true,
    contextWindow: 1050000,
  },
  {
    id: "openai/gpt-5.4-mini",
    provider: "openai",
    pricing: {
      inputUsdPerMillionTokens: 0.75,
      outputUsdPerMillionTokens: 4.5,
    },
    supportsThinking: true,
    contextWindow: 400000,
  },
  {
    id: "openai/gpt-5.3-codex",
    provider: "openai",
    pricing: {
      inputUsdPerMillionTokens: 1.75,
      outputUsdPerMillionTokens: 14,
    },
    supportsThinking: true,
    contextWindow: 400000,
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

export type ModelShortlistEntry = {
  id: SupportedChatModelId;
  label: string;
};

/**
 * Curated picker list spanning free → frontier strong tool-callers. Every id is
 * a SUPPORTED_CHAT_MODELS id (so it resolves), and all are OpenRouter-routable.
 * Used by onboarding and the in-app model switcher; a free-form override (any
 * OpenRouter id) is always accepted in addition to this list.
 */
export const MODEL_SHORTLIST: readonly ModelShortlistEntry[] = [
  { id: "z-ai/glm-4.5-air:free", label: "GLM 4.5 Air (free)" },
  { id: "deepseek/deepseek-v4-flash:free", label: "DeepSeek V4 Flash (free)" },
  { id: "openai/gpt-oss-120b:free", label: "GPT-OSS 120B (free)" },
  { id: "z-ai/glm-5.1", label: "GLM 5.1" },
  { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6" },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "openai/gpt-5.5", label: "GPT-5.5" },
  { id: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-opus-4.8", label: "Claude Opus 4.8" },
] as const;

/**
 * Friendly aliases accepted as model overrides (e.g. the Agent tool's `model`
 * field). Single source of truth — the Agent tool's enum is derived from these
 * keys, and `satisfies` ties every value to a real SUPPORTED_CHAT_MODELS id, so
 * an out-of-date slug is a compile error.
 */
export const MODEL_ALIASES = {
  sonnet: "anthropic/claude-sonnet-4.6",
  opus: "anthropic/claude-opus-4.8",
  haiku: "anthropic/claude-haiku-4.5",
  gpt: "openai/gpt-5.5",
  gpt_pro: "openai/gpt-5.5-pro",
  gpt_mini: "openai/gpt-5.4-mini",
  gpt_codex: "openai/gpt-5.3-codex",
  gpt_oss: "openai/gpt-oss-120b:free",
  glm: "z-ai/glm-5.1",
  glm_air: "z-ai/glm-4.5-air:free",
  kimi: "moonshotai/kimi-k2.6",
  deepseek: "deepseek/deepseek-v4-flash:free",
  minimax: "minimax/minimax-m2.7",
  nemotron: "nvidia/nemotron-3-super-120b-a12b:free",
} as const satisfies Record<string, SupportedChatModelId>;

export type ModelAlias = keyof typeof MODEL_ALIASES;

/** Non-empty tuple of alias names, for building a zod enum. */
export const MODEL_ALIAS_NAMES = Object.keys(MODEL_ALIASES) as [
  ModelAlias,
  ...ModelAlias[],
];

/** Resolve a friendly alias to its canonical OpenRouter id, or undefined. */
export function resolveModelAlias(
  alias: string,
): SupportedChatModelId | undefined {
  return (MODEL_ALIASES as Record<string, SupportedChatModelId>)[alias];
}
