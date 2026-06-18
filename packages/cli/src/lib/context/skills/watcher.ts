import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import chokidar, { type FSWatcher } from "chokidar";
import { debugLog } from "../../debug";
import { invalidateRequestContextCache } from "../../inference/build-request-context";
import { getProjectDirsUpToRoot } from "../file-discovery";
import { clearSkillCaches } from "../skills";
import { isSkillHotReloadEnabled } from "./config";

/**
 * Coalesce a burst of file events into a single reload after `delayMs` of
 * quiet. chokidar fires several events per change (add/change/unlink, plus
 * dir events), so a debounce keeps cache invalidation from thrashing.
 */
export function createDebouncedReload(
  onReload: () => void,
  delayMs = 250,
): { trigger: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onReload();
      }, delayMs);
    },
    dispose() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}

/**
 * Watch the global + project skill dirs for SKILL.md changes and clear the
 * skill + request-context caches on change, so edited/added/removed skills
 * appear without a restart. chokidar handles recursion cross-platform. Returns
 * a stop function. No-op (returns a no-op stop) when hot-reload is disabled or
 * no skill dirs exist.
 */
export function startSkillWatcher(cwd = process.cwd()): () => void {
  if (!isSkillHotReloadEnabled()) return () => {};

  const dirs = new Set<string>();
  const globalDir = join(homedir(), ".knightcode", "skills");
  if (existsSync(globalDir)) dirs.add(globalDir);
  for (const d of getProjectDirsUpToRoot("skills", cwd)) {
    if (existsSync(d)) dirs.add(d);
  }
  if (dirs.size === 0) return () => {};

  const debounced = createDebouncedReload(() => {
    clearSkillCaches();
    invalidateRequestContextCache();
    debugLog("skills.watcher", "skill dirs changed — caches cleared");
  });

  let watcher: FSWatcher | null = null;
  try {
    watcher = chokidar.watch([...dirs], {
      // Don't fire for the initial scan — only real post-startup changes.
      ignoreInitial: true,
      // Skill bodies live at <dir>/<name>/SKILL.md; one level is enough, but
      // a shallow recursive watch is harmless here (dirs are small).
      depth: 2,
    });
    // Only react to SKILL.md content changes and skill dir add/remove; ignore
    // unrelated files a user might drop alongside a skill.
    watcher.on("all", (event: string, path: string) => {
      const isSkillFile = path.replace(/\\/g, "/").endsWith("/SKILL.md");
      const isDirEvent = event === "addDir" || event === "unlinkDir";
      if (isSkillFile || isDirEvent) debounced.trigger();
    });
    // Never let a watcher error crash the session.
    watcher.on("error", () => {});
  } catch {
    // chokidar refused to start (rare under Bun) — hot-reload is best-effort.
    watcher = null;
  }

  return () => {
    debounced.dispose();
    if (watcher) void watcher.close();
  };
}
