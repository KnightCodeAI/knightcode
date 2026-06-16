import { appendFileSync } from "fs";
import { join } from "path";
import { knightcodeHome } from "./paths";

/** Debug logging is opt-in via KNIGHTCODE_DEBUG (anything but ""/0/false). */
export function isDebugEnabled(): boolean {
  const v = process.env.KNIGHTCODE_DEBUG?.trim().toLowerCase();
  return !!v && v !== "0" && v !== "false";
}

/**
 * Append a line to ~/.knightcode/debug.log when KNIGHTCODE_DEBUG is set. Used
 * for background work that has no UI surface (memory recall/extraction, side
 * queries) so failures aren't silent. Never throws and never writes to
 * stdout/stderr (would corrupt the TUI).
 */
export function debugLog(scope: string, ...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  try {
    const body = args
      .map((a) => {
        if (typeof a === "string") return a;
        // Guard each arg so a single hostile value (BigInt, circular ref, an
        // object whose toString/Symbol.toPrimitive throws, a null-prototype
        // object) can't drop the whole log entry. Both JSON.stringify and the
        // String() coercion fallback can throw, so each is wrapped.
        try {
          const s = JSON.stringify(a);
          if (s !== undefined) return s;
        } catch {
          // fall through to coercion
        }
        try {
          return String(a);
        } catch {
          return "[unserializable]";
        }
      })
      .join(" ");
    const line = `[${new Date().toISOString()}] [${scope}] ${body}\n`;
    appendFileSync(join(knightcodeHome(), "debug.log"), line, "utf-8");
  } catch {
    // logging must never break the app
  }
}
