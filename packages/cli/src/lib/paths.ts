import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Base directory for KnightCode config/data. Overridable via KNIGHTCODE_HOME
 * (used by tests and for relocating config). Read lazily on every call so env
 * changes take effect.
 */
export function knightcodeHome(): string {
  return process.env.KNIGHTCODE_HOME ?? join(homedir(), ".knightcode");
}
