import { describe, it, expect } from "bun:test";
import { createDebouncedReload, startSkillWatcher } from "./watcher";

describe("skill watcher", () => {
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

  it("startSkillWatcher returns a callable stop function", () => {
    const stop = startSkillWatcher(process.cwd());
    expect(typeof stop).toBe("function");
    stop(); // must not throw
  });
});
