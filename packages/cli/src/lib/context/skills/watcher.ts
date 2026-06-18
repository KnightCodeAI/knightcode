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

// Bun's native fs.watch (the backend chokidar uses by default) has a
// PathWatcherManager deadlock (oven-sh/bun#27469, #26385): closing a watcher on
// the main thread while the watcher thread is delivering events can hang both
// threads. chokidar reliably hits this when a git operation churns many dirs at
// once. Claude Code's skillChangeDetector works around it by forcing stat()
// polling under Bun — no FSWatcher, no deadlock. We do the same.
const USE_POLLING = typeof Bun !== "undefined";
const POLLING_INTERVAL_MS = 2000; // skills change rarely; cheap polling cadence
const WRITE_STABILITY_MS = 300; // wait for writes to settle before firing

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
      persistent: true,
      // Don't fire for the initial scan — only real post-startup changes.
      ignoreInitial: true,
      // Reach <.knightcode>/skills/<name>/SKILL.md without watching the whole tree.
      depth: WATCH_DEPTH,
      // Wait for writes to settle so a multi-write save fires once, not mid-write.
      awaitWriteFinish: {
        stabilityThreshold: WRITE_STABILITY_MS,
        pollInterval: 100,
      },
      // Skip .git / node_modules churn and special files (sockets/FIFOs error on macOS).
      ignored: (p: string, stats?: { isFile(): boolean; isDirectory(): boolean }) => {
        if (stats && !stats.isFile() && !stats.isDirectory()) return true;
        return p
          .split(/[\\/]/)
          .some((seg) => seg === ".git" || seg === "node_modules");
      },
      ignorePermissionErrors: true,
      atomic: true,
      // See USE_POLLING above — avoids the Bun fs.watch deadlock.
      usePolling: USE_POLLING,
      interval: POLLING_INTERVAL_MS,
    });
    // React to SKILL.md adds/changes/removals under any watched root. Watching
    // the parent means a file 'add' fires even for the first-ever skill; the
    // path filter ignores sibling .knightcode content (memory, settings, logs).
    const onSkillEvent = (path: string) => {
      const p = path.replace(/\\/g, "/");
      if (p.includes("/skills/") && p.endsWith("/SKILL.md")) {
        debounced.trigger();
      }
    };
    watcher.on("add", onSkillEvent);
    watcher.on("change", onSkillEvent);
    watcher.on("unlink", onSkillEvent);
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
