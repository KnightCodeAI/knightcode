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
 * App-attribution headers for OpenRouter, plus the optional session grouping
 * header. `x-session-id` makes OpenRouter group the session's requests in its
 * logs (Sessions tab) and use it as a sticky routing key (same provider →
 * better prompt-cache hits). The `user` body field (set in resolveModel) only
 * populates per-request "Client User ID"; session grouping needs this header.
 */
export function buildOpenRouterHeaders(
  sessionId?: string,
): Record<string, string> {
  return {
    "HTTP-Referer": "https://knightcode.raghavseth.in",
    "X-Title": "KnightCode",
    // OpenRouter caps session_id at 256 chars; our ids are well under that.
    ...(sessionId ? { "x-session-id": sessionId.slice(0, 256) } : {}),
  };
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
  /** Sent to OpenRouter as the `user` field so requests are attributable to a
   *  session (enables per-session reasoning about spend). */
  sessionId?: string;
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
    headers: buildOpenRouterHeaders(options.sessionId),
  });

  const canonicalId = toOpenRouterModelId(modelId);
  const def = findSupportedChatModel(modelId);
  // Known + non-thinking → omit reasoning. Known + thinking, or unknown
  // free-form → include it (unknown ids let OpenRouter decide).
  const includeReasoning = def ? def.supportsThinking === true : true;

  // usage.include asks OpenRouter to return the *actual* cost of each request
  // (accurate across free/cached/uncurated models). `user` tags the request
  // with the session so spend is attributable. Reasoning is folded into the
  // same openrouter options object.
  return {
    model: openrouter.chat(canonicalId),
    modelId: canonicalId,
    providerOptions: {
      openrouter: {
        usage: { include: true },
        ...(options.sessionId ? { user: options.sessionId } : {}),
        ...(includeReasoning
          ? { reasoning: { effort: toOpenRouterEffort(reasoningEffort) } }
          : {}),
      },
    },
  };
}
