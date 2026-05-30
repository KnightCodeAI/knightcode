import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Base directory for KnightCode config/data. Overridable via KNIGHTCODE_HOME
 * (used by tests and for relocating config). Read lazily on every call so env
 * changes take effect.
 */
export function knightcodeHome(): string {
  // Trim + truthy-check so an empty/whitespace override falls back rather than
  // resolving to an empty/cwd-relative base (?? would let "" through).
  const home = process.env.KNIGHTCODE_HOME?.trim();
  return home ? home : join(homedir(), ".knightcode");
}
