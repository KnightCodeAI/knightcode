import { describe, it, expect } from "bun:test";
import {
  isSkillAutoDiscoverEnabled,
  isSkillHotReloadEnabled,
} from "./config";

describe("skill config", () => {
  it("auto-discover defaults to enabled", () => {
    // No setting written in the test env → default on.
    expect(typeof isSkillAutoDiscoverEnabled()).toBe("boolean");
    expect(isSkillAutoDiscoverEnabled()).toBe(true);
  });

  it("hot-reload defaults to enabled", () => {
    expect(isSkillHotReloadEnabled()).toBe(true);
  });
});
