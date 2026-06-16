import { join } from "path";
import { knightcodeHome } from "../paths";

/**
 * Encode a working directory into a filesystem-safe folder name for the
 * per-project memory layout (path separators and the drive colon become
 * dashes). e.g. `C:\Users\x\proj` → `C-Users-x-proj`.
 */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[\\/:]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Per-project auto-memory directory: ~/.knightcode/projects/<cwd>/memory/ */
export function getMemoryDir(cwd: string): string {
  return join(knightcodeHome(), "projects", encodeProjectPath(cwd), "memory");
}

/** The MEMORY.md index inside the project's memory directory. */
export function getMemoryIndexPath(cwd: string): string {
  return join(getMemoryDir(cwd), "MEMORY.md");
}
