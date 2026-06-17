import { findSupportedChatModel } from "@repo/shared";

export type UsageItem = {
  input: number;
  output: number;
  model: string;
  /** OpenRouter's actual reported cost for this message, when available. */
  costUsd?: number;
};

export type TokenStats = {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  lastInputTokens?: number;
};

/**
 * Aggregate per-message usage into session totals. Cost prefers OpenRouter's
 * actual reported `costUsd` (accurate for every model, including free/cached/
 * uncurated); when a message predates usage accounting or the provider omitted
 * it, falls back to the local price table. A model with neither contributes $0.
 */
export function computeTokenStats(items: UsageItem[]): TokenStats {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalCost = 0;
  let lastInputTokens: number | undefined;

  for (const item of items) {
    inputTokens += item.input;
    outputTokens += item.output;
    lastInputTokens = item.input;

    if (typeof item.costUsd === "number") {
      totalCost += item.costUsd;
      continue;
    }
    const modelDef = findSupportedChatModel(item.model);
    if (modelDef?.pricing) {
      totalCost +=
        (item.input / 1_000_000) * modelDef.pricing.inputUsdPerMillionTokens +
        (item.output / 1_000_000) * modelDef.pricing.outputUsdPerMillionTokens;
    }
  }

  return { inputTokens, outputTokens, totalCost, lastInputTokens };
}
