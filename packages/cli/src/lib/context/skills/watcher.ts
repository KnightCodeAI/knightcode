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

// Skill bodies live at <.knightcode>/skills/<name>/SKILL.md — three levels below
// a watched .knightcode root. We watch the .knightcode PARENT dirs rather than
// the skills dirs directly so that creating the very first skill (or even the
// first skills/ dir) mid-session is picked up too; getProjectDirsUpToRoot only
// returns skills dirs that already exist, which would miss that case.
const WATCH_DEPTH = 3;

/** Existing `.knightcode` roots to watch: global (~/.knightcode) + per-project. */
export function skillWatchRoots(cwd: string): string[] {
  const roots = new Set<string>();
  const globalRoot = join(homedir(), ".knightcode");
  if (existsSync(globalRoot)) roots.add(globalRoot);
  // subdir "" → "<dir>/.knightcode"; the helper only returns existing dirs.
  for (const d of getProjectDirsUpToRoot("", cwd)) {
    if (existsSync(d)) roots.add(d);
  }
  return [...roots];
}

/**
 * Watch the global + project `.knightcode` dirs for skill changes and clear the
 * skill + request-context caches on change, so added/edited/removed skills
 * appear without a restart. chokidar handles recursion cross-platform. Returns
 * a stop function. No-op (returns a no-op stop) when hot-reload is disabled or
 * no `.knightcode` dir exists.
 */
export function startSkillWatcher(cwd = process.cwd()): () => void {
  if (!isSkillHotReloadEnabled()) return () => {};

  const roots = skillWatchRoots(cwd);
  if (roots.length === 0) return () => {};

  const debounced = createDebouncedReload(() => {
    clearSkillCaches();
    invalidateRequestContextCache();
    debugLog("skills.watcher", "skills changed — caches cleared");
  });

  let watcher: FSWatcher | null = null;
  try {
    watcher = chokidar.watch(roots, {
      // Don't fire for the initial scan — only real post-startup changes.
      ignoreInitial: true,
      // Reach <.knightcode>/skills/<name>/SKILL.md without watching the whole tree.
      depth: WATCH_DEPTH,
    });
    // Only react to events under a skills/ path: a SKILL.md write, or a skill
    // dir add/remove. Ignores sibling .knightcode content (memory, settings,
    // debug.log) so unrelated writes don't churn the caches.
    watcher.on("all", (event: string, path: string) => {
      const p = path.replace(/\\/g, "/");
      const underSkills = p.includes("/skills/") || p.endsWith("/skills");
      if (!underSkills) return;
      const isSkillFile = p.endsWith("/SKILL.md");
      const isDirEvent = event === "addDir" || event === "unlinkDir";
      if (isSkillFile || isDirEvent) debounced.trigger();
    });
    // Surface watcher errors to the debug log rather than swallowing them.
    watcher.on("error", (err) =>
      debugLog("skills.watcher", "watch error:", String(err)),
    );
  } catch (err) {
    // chokidar refused to start (rare under Bun) — hot-reload is best-effort.
    debugLog("skills.watcher", "failed to start watcher:", String(err));
    watcher = null;
  }

  return () => {
    debounced.dispose();
    if (watcher) void watcher.close();
  };
}
