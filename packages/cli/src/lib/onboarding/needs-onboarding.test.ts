import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCredentials } from "../credentials";
import { isOnboardingNeeded } from "./needs-onboarding";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kc-onb-"));
  process.env.KNIGHTCODE_HOME = dir;
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  delete process.env.KNIGHTCODE_HOME;
  delete process.env.OPENROUTER_API_KEY;
  rmSync(dir, { recursive: true, force: true });
});

describe("isOnboardingNeeded", () => {
  test("true when no key is resolvable", () => {
    expect(isOnboardingNeeded()).toBe(true);
  });

  test("false when a key is in the credentials file", () => {
    saveCredentials({ openRouterApiKey: "sk-or-abc" });
    expect(isOnboardingNeeded()).toBe(false);
  });

  test("false when the key comes from the environment", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-env";
    expect(isOnboardingNeeded()).toBe(false);
  });
});
