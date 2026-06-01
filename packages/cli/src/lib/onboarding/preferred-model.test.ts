import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CHAT_MODEL_ID } from "@knightcode/shared";
import { setSettingValue } from "../settings";
import { loadPreferredModel } from "./preferred-model";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kc-pref-model-"));
  process.env.KNIGHTCODE_HOME = dir;
});

afterEach(() => {
  delete process.env.KNIGHTCODE_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("loadPreferredModel", () => {
  test("defaults when nothing is stored", () => {
    expect(loadPreferredModel()).toBe(DEFAULT_CHAT_MODEL_ID);
  });

  test("returns a stored, supported model id", () => {
    setSettingValue("model", "openai/gpt-5.5");
    expect(loadPreferredModel()).toBe("openai/gpt-5.5");
  });

  test("ignores an unsupported stored value and falls back to default", () => {
    setSettingValue("model", "totally/made-up");
    expect(loadPreferredModel()).toBe(DEFAULT_CHAT_MODEL_ID);
  });
});
