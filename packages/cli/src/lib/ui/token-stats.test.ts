import { describe, expect, test } from "bun:test";
import { computeTokenStats } from "./token-stats";

describe("computeTokenStats", () => {
  test("prefers OpenRouter's real cost over the local price table", () => {
    const stats = computeTokenStats([
      // A pricey curated model, but a real cost was reported → use the real one.
      { input: 1_000_000, output: 1_000_000, model: "anthropic/claude-opus-4.8", costUsd: 0.02 },
    ]);
    expect(stats.totalCost).toBe(0.02);
  });

  test("sums real costs across messages", () => {
    const stats = computeTokenStats([
      { input: 10, output: 5, model: "m", costUsd: 0.01 },
      { input: 20, output: 8, model: "m", costUsd: 0.025 },
    ]);
    expect(stats.totalCost).toBeCloseTo(0.035, 6);
  });

  test("falls back to the price table when no real cost is present", () => {
    // haiku-4.5: $1 / $5 per million in/out → 1M+1M = $6.
    const stats = computeTokenStats([
      { input: 1_000_000, output: 1_000_000, model: "anthropic/claude-haiku-4.5" },
    ]);
    expect(stats.totalCost).toBeCloseTo(6, 6);
  });

  test("contributes $0 for an uncurated model with no reported cost", () => {
    const stats = computeTokenStats([
      { input: 1000, output: 1000, model: "vendor/unknown-model" },
    ]);
    expect(stats.totalCost).toBe(0);
  });

  test("sums tokens and tracks the last input size", () => {
    const stats = computeTokenStats([
      { input: 100, output: 40, model: "m", costUsd: 0 },
      { input: 250, output: 90, model: "m", costUsd: 0 },
    ]);
    expect(stats.inputTokens).toBe(350);
    expect(stats.outputTokens).toBe(130);
    expect(stats.lastInputTokens).toBe(250);
  });

  test("empty input → zeroed totals, no last input", () => {
    const stats = computeTokenStats([]);
    expect(stats).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      lastInputTokens: undefined,
    });
  });
});
