import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isSkillAutoDiscoverEnabled,
  isSkillHotReloadEnabled,
} from "./config";

// Settings come from `${KNIGHTCODE_HOME}/settings.json`. Point KNIGHTCODE_HOME
// at an empty temp dir so these assertions test the real defaults rather than
// the developer's local settings.json.
let prevHome: string | undefined;
let home: string;

describe("skill config", () => {
  beforeEach(() => {
    prevHome = process.env.KNIGHTCODE_HOME;
    home = mkdtempSync(join(tmpdir(), "kc-skillcfg-"));
    process.env.KNIGHTCODE_HOME = home;
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.KNIGHTCODE_HOME;
    else process.env.KNIGHTCODE_HOME = prevHome;
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("auto-discover defaults to enabled", () => {
    // No settings.json in the isolated home → default on.
    expect(isSkillAutoDiscoverEnabled()).toBe(true);
  });

  it("hot-reload defaults to enabled", () => {
    expect(isSkillHotReloadEnabled()).toBe(true);
  });

  it("respects an explicit false in settings.json", () => {
    writeFileSync(
      join(home, "settings.json"),
      JSON.stringify({ skills: { autoDiscover: false, hotReload: false } }),
      "utf-8",
    );
    expect(isSkillAutoDiscoverEnabled()).toBe(false);
    expect(isSkillHotReloadEnabled()).toBe(false);
  });
});
