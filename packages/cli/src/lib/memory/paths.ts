import { join } from "path";
import { createHash } from "crypto";
import { knightcodeHome } from "../paths";

// Cap the human-readable slug so the folder name stays well under the common
// 255-byte filename-component limit; the hash guarantees uniqueness regardless,
// so truncating the (cosmetic) slug is safe.
const MAX_SLUG_LEN = 200;

/**
 * Encode a working directory into a filesystem-safe, collision-resistant folder
 * name for the per-project memory layout. A readable, length-bounded slug is
 * suffixed with a short hash of the normalized path, so distinct directories
 * that would slugify to the same string — e.g. `/a/b` and `/a-b`, both `a-b` —
 * never share a store. On case-insensitive platforms (Windows, macOS) the path
 * is case-folded first, so `C:\Proj` and `c:\proj` map to one store.
 * e.g. `C:\Users\x\proj` → `c-users-x-proj-1a2b3c4d`.
 */
export function encodeProjectPath(cwd: string): string {
  // Normalize separators; case-fold only where the filesystem is case-insensitive
  // so the same directory maps to one store without over-merging on Linux.
  const caseInsensitive =
    process.platform === "win32" || process.platform === "darwin";
  let key = cwd.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  if (caseInsensitive) key = key.toLowerCase();

  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  const slug = key
    .replace(/[/:]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/g, "");
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
