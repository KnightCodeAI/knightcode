import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
  findSupportedChatModel,
  type SupportedChatModel,
  type SupportedChatModelId,
  type SupportedProvider,
  type ReasoningEffortLevel,
} from "@knightcode/shared";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

const openrouter = createOpenRouter({
  headers: {
    "HTTP-Referer": "https://github.com/Raghav1428/knightcode",
    "X-Title": "KnightCode CLI",
  },
});

type AnthropicModelId = Extract<
  SupportedChatModel,
  { provider: "anthropic" }
>["id"];
type OpenAIModelId = Extract<SupportedChatModel, { provider: "openai" }>["id"];
type OpenRouterModelId = Extract<
  SupportedChatModel,
  { provider: "openrouter" }
>["id"];

export type ResolvedModel = {
  model: LanguageModel;
  provider: SupportedProvider;
  modelId: SupportedChatModelId;
  providerOptions?: ProviderOptions;
};

function buildProviderOptions(
  model: SupportedChatModel,
  reasoningEffort: ReasoningEffortLevel = "medium",
): ProviderOptions | undefined {
  if (!model.supportsThinking) {
    return undefined;
  }

  if (reasoningEffort === "none") {
    if (model.provider === "openai") {
      return {
        openai: {
          reasoningEffort: "none",
        },
      };
    }
    if (model.provider === "openrouter") {
      return {
        openrouter: {
          reasoning: {
            effort: "none",
          },
        },
      };
    }
    return undefined;
  }

  if (model.provider === "anthropic") {
    let budget = 4096;
    if (reasoningEffort === "low") budget = 1024;
    else if (reasoningEffort === "high") budget = 8192;
    else if (reasoningEffort === "max") budget = 16384;

    return {
      anthropic: {
        thinking: {
          type: "enabled",
          budgetTokens: budget,
        },
      },
    };
  }

  if (model.provider === "openai") {
    const effort = reasoningEffort === "max" ? "high" : reasoningEffort;
    return {
      openai: {
        reasoningEffort: effort,
      },
    };
  }

  if (model.provider === "openrouter") {
    const effort = reasoningEffort === "max" ? "xhigh" : reasoningEffort;
    return {
      openrouter: {
        reasoning: {
          effort,
        },
      },
    };
  }

  return undefined;
}

function resolveAnthropicModel(
  modelId: AnthropicModelId,
  reasoningEffort?: ReasoningEffortLevel,
): ResolvedModel {
  const modelDef = findSupportedChatModel(modelId)!;
  return {
    model: anthropic(modelId),
    provider: "anthropic",
    modelId,
    providerOptions: buildProviderOptions(modelDef, reasoningEffort),
  };
}

function resolveOpenAIModel(
  modelId: OpenAIModelId,
  reasoningEffort?: ReasoningEffortLevel,
): ResolvedModel {
  const modelDef = findSupportedChatModel(modelId)!;
  return {
    model: openai(modelId),
    provider: "openai",
    modelId,
    providerOptions: buildProviderOptions(modelDef, reasoningEffort),
  };
}

function resolveOpenRouterModel(
  modelId: OpenRouterModelId,
  reasoningEffort?: ReasoningEffortLevel,
): ResolvedModel {
  const modelDef = findSupportedChatModel(modelId)!;
  return {
    model: openrouter.chat(modelId),
    provider: "openrouter",
    modelId,
    providerOptions: buildProviderOptions(modelDef, reasoningEffort),
  };
}

function assertUnsupportedProvider(provider: never): never {
  throw new Error(`Unsupported provider: ${provider}`);
}

function resolveSupportedChatModel(
  model: SupportedChatModel,
  reasoningEffort?: ReasoningEffortLevel,
): ResolvedModel {
  const provider = model.provider;

  switch (provider) {
    case "anthropic":
      return resolveAnthropicModel(model.id, reasoningEffort);
    case "openai":
      return resolveOpenAIModel(model.id, reasoningEffort);
    case "openrouter":
      return resolveOpenRouterModel(model.id, reasoningEffort);
    default:
      return assertUnsupportedProvider(provider);
  }
}

export function isSupportedChatModel(
  modelId: string,
): modelId is SupportedChatModelId {
  return findSupportedChatModel(modelId) != null;
}

export function resolveChatModel(
  modelId: string,
  reasoningEffort?: ReasoningEffortLevel,
): ResolvedModel {
  const model = findSupportedChatModel(modelId);
  if (!model) {
    throw new Error(`Unsupported model: ${modelId}`);
  }

  return resolveSupportedChatModel(model, reasoningEffort);
}
