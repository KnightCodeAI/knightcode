import { describe, expect, test } from "bun:test";
import {
  buildOpenRouterReasoningOptions,
  resolveModel,
  toOpenRouterModelId,
} from "./resolve-model";

describe("buildOpenRouterReasoningOptions", () => {
  test("maps a standard effort straight through", () => {
    expect(buildOpenRouterReasoningOptions("high")).toEqual({
      openrouter: { reasoning: { effort: "high" } },
    });
  });

  test("maps 'max' to OpenRouter's 'xhigh'", () => {
    expect(buildOpenRouterReasoningOptions("max")).toEqual({
      openrouter: { reasoning: { effort: "xhigh" } },
    });
  });

  test("maps 'none' to 'none'", () => {
    expect(buildOpenRouterReasoningOptions("none")).toEqual({
      openrouter: { reasoning: { effort: "none" } },
    });
  });

  test("defaults to medium when the effort is omitted", () => {
    expect(buildOpenRouterReasoningOptions()).toEqual({
      openrouter: { reasoning: { effort: "medium" } },
    });
  });
});

describe("toOpenRouterModelId", () => {
  test("passes a canonical anthropic id through unchanged", () => {
    expect(toOpenRouterModelId("anthropic/claude-opus-4.8")).toBe(
      "anthropic/claude-opus-4.8",
    );
  });

  test("passes a canonical openai id through unchanged", () => {
    expect(toOpenRouterModelId("openai/gpt-5.5")).toBe("openai/gpt-5.5");
  });

  test("passes a native OpenRouter id through unchanged", () => {
    expect(toOpenRouterModelId("z-ai/glm-4.5-air:free")).toBe(
      "z-ai/glm-4.5-air:free",
    );
  });

  test("passes an unknown free-form id through unchanged", () => {
    expect(toOpenRouterModelId("vendor/experimental-model")).toBe(
      "vendor/experimental-model",
    );
  });
});

describe("resolveModel", () => {
  const KEY = "sk-or-test-key";

  test("throws a clear error when no API key can be resolved", () => {
    expect(() =>
      resolveModel("z-ai/glm-4.5-air:free", "medium", {
        getApiKey: () => undefined,
      }),
    ).toThrow(/OpenRouter API key/i);
  });

  test("returns the canonical model id and reasoning options for a thinking model", () => {
    const resolved = resolveModel("anthropic/claude-opus-4.8", "high", {
      apiKey: KEY,
    });
    expect(resolved.modelId).toBe("anthropic/claude-opus-4.8");
    expect(resolved.model).toBeDefined();
    expect(resolved.providerOptions).toEqual({
      openrouter: { reasoning: { effort: "high" } },
    });
  });

  test("maps 'max' effort to OpenRouter's 'xhigh'", () => {
    const resolved = resolveModel("openai/gpt-5.5", "max", { apiKey: KEY });
    expect(resolved.providerOptions).toEqual({
      openrouter: { reasoning: { effort: "xhigh" } },
    });
  });

  // Every curated model in SUPPORTED_CHAT_MODELS supports thinking, so the
  // "known but non-thinking → omit reasoning" branch is exercised only by
  // hypothetical future models; the unknown-id case below covers the fallback.

  test("applies reasoning options to an unknown free-form id (lets OpenRouter decide)", () => {
    const resolved = resolveModel("vendor/experimental-model", "low", {
      apiKey: KEY,
    });
    expect(resolved.modelId).toBe("vendor/experimental-model");
    expect(resolved.providerOptions).toEqual({
      openrouter: { reasoning: { effort: "low" } },
    });
  });
});
