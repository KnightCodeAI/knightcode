import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getOpenRouterApiKey,
  getSearchApiKey,
  getSearchProvider,
} from "../credentials";
import { getSettingValue } from "../settings";
import { completeOnboarding } from "./complete";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kc-onb-complete-"));
  process.env.KNIGHTCODE_HOME = dir;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.KNIGHTCODE_SEARCH_PROVIDER;
  delete process.env.KNIGHTCODE_SEARCH_API_KEY;
});

afterEach(() => {
  delete process.env.KNIGHTCODE_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("completeOnboarding", () => {
  test("persists the key and model, no search by default", () => {
    completeOnboarding({
      openRouterApiKey: "sk-or-abc",
      model: "z-ai/glm-5.2",
    });
    expect(getOpenRouterApiKey()).toBe("sk-or-abc");
    expect(getSettingValue("model")).toBe("z-ai/glm-5.2");
    expect(getSearchProvider()).toBeUndefined();
    expect(getSearchApiKey()).toBeUndefined();
  });

  test("persists the optional search provider + key", () => {
    completeOnboarding({
      openRouterApiKey: "sk-or-abc",
      model: "openai/gpt-5.5",
      search: { provider: "brave", apiKey: "brave-key" },
    });
    expect(getSearchProvider()).toBe("brave");
    expect(getSearchApiKey()).toBe("brave-key");
  });

  test("ignores a search config whose key is empty/whitespace", () => {
    completeOnboarding({
      openRouterApiKey: "sk-or-abc",
      model: "z-ai/glm-5.2",
      search: { provider: "brave", apiKey: "   " },
    });
    expect(getSearchProvider()).toBeUndefined();
    expect(getSearchApiKey()).toBeUndefined();
  });
});
