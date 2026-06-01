import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSettingsPath,
  getSettingValue,
  loadSettings,
  saveSettings,
  setSettingValue,
} from "./settings";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kc-settings-"));
  process.env.KNIGHTCODE_HOME = dir;
});

afterEach(() => {
  delete process.env.KNIGHTCODE_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("settings io honors KNIGHTCODE_HOME", () => {
  test("settings path is under KNIGHTCODE_HOME", () => {
    expect(getSettingsPath()).toBe(join(dir, "settings.json"));
  });

  test("saveSettings then loadSettings round-trips", () => {
    saveSettings({ model: "z-ai/glm-5.1" });
    expect(loadSettings().model).toBe("z-ai/glm-5.1");
  });

  test("setSettingValue/getSettingValue round-trip the model key", () => {
    setSettingValue("model", "openai/gpt-5.5");
    expect(getSettingValue("model")).toBe("openai/gpt-5.5");
  });

  test("loadSettings returns {} when the file is absent", () => {
    expect(loadSettings()).toEqual({});
  });
});
