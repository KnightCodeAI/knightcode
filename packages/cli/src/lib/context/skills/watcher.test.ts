import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  createDebouncedReload,
  startSkillWatcher,
  skillWatchRoots,
} from "./watcher";

const norm = (p: string) =>
  p.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");

// Track temp dirs so afterEach can remove them — otherwise each run leaks one.
const tempDirs: string[] = [];
function mkTmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(d);
  return d;
}

describe("skill watcher", () => {
  afterEach(() => {
    while (tempDirs.length) {
      try {
        rmSync(tempDirs.pop()!, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  });

  it("debounces multiple triggers into a single reload", async () => {
    let reloads = 0;
    const d = createDebouncedReload(() => reloads++, 20);
    d.trigger();
    d.trigger();
    d.trigger();
    expect(reloads).toBe(0); // not yet
    await new Promise((r) => setTimeout(r, 50));
    expect(reloads).toBe(1); // coalesced into one
    d.dispose();
  });

  it("dispose cancels a pending reload", async () => {
    let reloads = 0;
    const d = createDebouncedReload(() => reloads++, 20);
    d.trigger();
    d.dispose();
    await new Promise((r) => setTimeout(r, 50));
    expect(reloads).toBe(0);
  });

  it("watches the .knightcode parent even when no skills dir exists yet", () => {
    // Root-cause coverage for the 'first skill created mid-session' case: the
    // watch root is the .knightcode parent, so a not-yet-created skills/ dir is
    // still covered.
    const projectDir = mkTmp("kc-watchroot-");
    mkdirSync(join(projectDir, ".knightcode")); // note: no skills/ subdir
    const roots = skillWatchRoots(projectDir).map(norm);
    expect(roots).toContain(norm(join(resolve(projectDir), ".knightcode")));
  });

  describe("startSkillWatcher (isolated, no real watcher)", () => {
    let prevHome: string | undefined;
    let home: string;
    beforeEach(() => {
      prevHome = process.env.KNIGHTCODE_HOME;
      home = mkTmp("kc-watch-");
      process.env.KNIGHTCODE_HOME = home;
    });
    afterEach(() => {
      if (prevHome === undefined) delete process.env.KNIGHTCODE_HOME;
      else process.env.KNIGHTCODE_HOME = prevHome;
    });

    it("returns a callable no-op stop when hot-reload is disabled", () => {
      // Disabling via the isolated settings.json means no real FSWatcher is
      // started, so nothing can outlive the test.
      writeFileSync(
        join(home, "settings.json"),
        JSON.stringify({ skills: { hotReload: false } }),
        "utf-8",
      );
      const stop = startSkillWatcher(home);
      expect(typeof stop).toBe("function");
      stop(); // must not throw
    });
  });
});
