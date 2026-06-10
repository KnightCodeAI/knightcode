import type { ProviderOptions } from "@ai-sdk/provider-utils";
import {
  findSupportedChatModel,
  type ReasoningEffortLevel,
} from "@repo/shared";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { getOpenRouterApiKey } from "../credentials";

/** OpenRouter's reasoning enum has no "max"; map it to "xhigh". */
function toOpenRouterEffort(effort: ReasoningEffortLevel) {
  return effort === "max" ? "xhigh" : effort;
}

export function buildOpenRouterReasoningOptions(
  effort: ReasoningEffortLevel = "medium",
): ProviderOptions {
  return { openrouter: { reasoning: { effort: toOpenRouterEffort(effort) } } };
}

/**
 * Map a stored model id to its OpenRouter-canonical form. Every curated model in
 * SUPPORTED_CHAT_MODELS is stored as a canonical OpenRouter id
 * ("anthropic/claude-...", "openai/gpt-...", "z-ai/glm-..."), and free-form
 * overrides are expected to be full OpenRouter ids too — so this is currently a
 * pass-through. Kept as the single seam where id rewriting would live.
 */
export function toOpenRouterModelId(modelId: string): string {
  return modelId;
}

export type ResolvedModel = {
  model: LanguageModel;
  modelId: string;
  providerOptions?: ProviderOptions;
};

export type ResolveModelOptions = {
  /** Explicit key (tests). */
  apiKey?: string;
  /** Lazy key lookup; defaults to credentials/env. */
  getApiKey?: () => string | undefined;
};

export function resolveModel(
  modelId: string,
  reasoningEffort: ReasoningEffortLevel = "medium",
  options: ResolveModelOptions = {},
): ResolvedModel {
  const apiKey = options.apiKey ?? (options.getApiKey ?? getOpenRouterApiKey)();
  if (!apiKey) {
    throw new Error(
      "No OpenRouter API key found. Set OPENROUTER_API_KEY or run onboarding to store one in ~/.knightcode/credentials.json.",
    );
  }

  const openrouter = createOpenRouter({
    apiKey,
    headers: {
      "HTTP-Referer": "https://github.com/KnightCodeAI/knightcode",
      "X-Title": "KnightCode CLI",
    },
  });

  const canonicalId = toOpenRouterModelId(modelId);
  const def = findSupportedChatModel(modelId);
  // Known + non-thinking → omit reasoning. Known + thinking, or unknown
  // free-form → include it (unknown ids let OpenRouter decide).
  const includeReasoning = def ? def.supportsThinking === true : true;

  return {
    model: openrouter.chat(canonicalId),
    modelId: canonicalId,
    providerOptions: includeReasoning
      ? buildOpenRouterReasoningOptions(reasoningEffort)
      : undefined,
  };
}
