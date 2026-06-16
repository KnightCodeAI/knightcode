import type { ContextProvider } from "../engine/context-providers";
import { debugLog } from "../debug";
import { getSessionModifiedFiles } from "../tools";

const MAX_LISTED = 20;

/**
 * A per-round context provider that reminds the model which files it has
 * modified so far this turn, re-injected after each tool round. Self-gates:
 * emits nothing until a file has actually been edited/written, and dedups so
 * the same unchanged list isn't re-sent every round.
 */
export function createChangedFilesProvider(): ContextProvider {
  let lastSignature: string | null = null;
  return {
    phase: "per_round",
    run: async ({ sessionId }) => {
      if (!sessionId) return [];
      let files: string[];
      try {
        files = getSessionModifiedFiles(sessionId);
      } catch {
        return [];
      }
      if (files.length === 0) return [];

      const signature = files.join("\n");
      if (signature === lastSignature) {
        debugLog("context.changedFiles", `unchanged (${files.length}) - skip`);
        return []; // unchanged since last round
      }
      lastSignature = signature;
      debugLog("context.changedFiles", `injecting ${files.length} file(s)`);

      const shown = files.slice(0, MAX_LISTED);
      const more =
        files.length > MAX_LISTED ? `\n…and ${files.length - MAX_LISTED} more` : "";
      return [
        `Files you have modified so far this turn (verify your changes are complete and consistent before finishing):\n${shown
          .map((f) => `- ${f}`)
          .join("\n")}${more}`,
      ];
    },
  };
}
