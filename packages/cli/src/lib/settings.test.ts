import { describe, expect, test } from "bun:test";
import { isSupportedSetting, getSettingMeta, SUPPORTED_SETTINGS } from "./settings";

describe("supported settings", () => {
  test("known settings are supported", () => {
    expect(isSupportedSetting("theme")).toBe(true);
    expect(isSupportedSetting("model")).toBe(true);
    expect(isSupportedSetting("nope")).toBe(false);
  });

  test("theme has enum options", () => {
    const meta = getSettingMeta("theme");
    expect(meta?.options).toBeDefined();
    expect(meta?.options!.length).toBeGreaterThan(0);
  });

  test("registry keys all have a path and type and match their key", () => {
    for (const [key, meta] of Object.entries(SUPPORTED_SETTINGS)) {
      expect(meta.path.length).toBeGreaterThan(0);
      expect(["string", "boolean", "number"]).toContain(meta.type);
      expect(key).toBe(meta.path.join("."));
    }
  });
});
