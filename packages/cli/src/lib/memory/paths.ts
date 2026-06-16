import { join } from "path";
import { createHash } from "crypto";
import { knightcodeHome } from "../paths";

/**
 * Encode a working directory into a filesystem-safe, collision-resistant folder
 * name for the per-project memory layout. A readable slug (path separators and
 * the drive colon become dashes) is suffixed with a short hash of the
 * separator-normalized path, so distinct directories that would slugify to the
 * same string — e.g. `/a/b` and `/a-b`, both `a-b` — never share a store.
 * e.g. `C:\Users\x\proj` → `C-Users-x-proj-1a2b3c4d`.
 */
export function encodeProjectPath(cwd: string): string {
  const slug = cwd.replace(/[\\/:]+/g, "-").replace(/^-+|-+$/g, "");
  // Normalize only separators (not case) so the same directory maps to one
  // store regardless of slash style, while genuinely different paths don't merge.
  const normalized = cwd.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
}

/** Per-project auto-memory directory: ~/.knightcode/projects/<cwd>/memory/ */
export function getMemoryDir(cwd: string): string {
  return join(knightcodeHome(), "projects", encodeProjectPath(cwd), "memory");
}

/** The MEMORY.md index inside the project's memory directory. */
export function getMemoryIndexPath(cwd: string): string {
  return join(getMemoryDir(cwd), "MEMORY.md");
}
