import type { ContextProvider } from "../../engine/context-providers";
import { debugLog } from "../../debug";
import { globToRegex } from "../rules";
import { getSessionModifiedFiles } from "../../tools";
import { listSkills, isConditionalSkill } from "../skills";

/** True if any glob matches the (cwd-relative) file path. */
export function fileMatchesGlobs(globs: string[], relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  return globs.some((g) => {
    if (!g.trim()) return false;
    try {
      return globToRegex(g).test(p);
    } catch {
      return false;
    }
  });
}

/**
 * Render the surfaced path-scoped skills into a blocking-requirement nudge,
 * mirroring claude-code's dynamic_skill directive.
 */
export function renderConditionalBlock(names: string[]): string {
  const list = names.join(", ");
  return (
    `You are editing files that match these path-scoped skills: ${list}. ` +
    `This is a BLOCKING REQUIREMENT: invoke the Skill tool to load the relevant one BEFORE continuing, then follow its instructions.`
  );
}

/**
 * A per-round ContextProvider that surfaces "conditional" skills — those with
 * `paths` frontmatter — when the model has modified a file matching their globs
 * this turn (claude-code's dynamic_skill mechanism). Each skill is surfaced once
 * per session via a sent-set. Surfacing is a nudge: the model loads the body via
 * the Skill tool. Reads aren't tracked yet (only edited/written files), so this
 * triggers on writes, not reads.
 */
export function createConditionalSkillProvider(opts: {
  /** Called with freshly-surfaced skill names so the embedder can show a
   *  visible "relevant skills" line in the chat. Fired once per skill. */
  onSurface?: (names: string[]) => void;
} = {}): ContextProvider {
  const sent = new Set<string>();
  return {
    phase: "per_round",
    run: async ({ cwd, sessionId }) => {
      if (!sessionId) return [];
      let files: string[];
      try {
        files = getSessionModifiedFiles(sessionId);
      } catch {
        return [];
      }
      if (files.length === 0) return [];

      const conditional = listSkills(cwd).filter(isConditionalSkill);
      if (conditional.length === 0) return [];

      const matched: string[] = [];
      for (const s of conditional) {
        if (sent.has(s.name)) continue;
        if (s.paths && files.some((f) => fileMatchesGlobs(s.paths!, f))) {
          matched.push(s.name);
        }
      }
      if (matched.length === 0) return [];

      matched.forEach((n) => sent.add(n));
      opts.onSurface?.(matched);
      debugLog("skills.conditional", `surfaced ${matched.length}`, matched);
      return [renderConditionalBlock(matched)];
    },
  };
}
