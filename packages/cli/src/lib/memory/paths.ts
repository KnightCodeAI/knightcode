import { dirname, join } from "path";
import { existsSync, statSync } from "fs";
import { createHash } from "crypto";
import { knightcodeHome } from "../paths";

// Byte budget for the cosmetic slug. The hash guarantees uniqueness, so the slug
// can be truncated freely; we cap by UTF-8 *bytes* (not JS chars) to honor the
// common ~255-byte filename-component limit even for multibyte (e.g. CJK) paths.
const MAX_SLUG_BYTES = 200;

// Detection is keyed by the probed ancestor and cached — encodeProjectPath can be
// called per memory op, and the filesystem's case behavior doesn't change at runtime.
const caseInsensitiveCache = new Map<string, boolean>();

/** Truncate `s` to at most `maxBytes` UTF-8 bytes without splitting a code point. */
function truncateToBytes(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    // for...of iterates by code point, so surrogate pairs stay intact
    const n = Buffer.byteLength(ch, "utf8");
    if (used + n > maxBytes) break;
    out += ch;
    used += n;
  }
  return out;
}

/**
 * Return `p` with the case of one letter flipped, preferring the letter closest
 * to the leaf so it best reflects the target directory. The Windows drive letter
 * is skipped (it's always case-insensitive and would mislead). Returns null when
 * the path has no flippable letter — a path with no letters has no casing to
 * vary, so detection can safely fall back to case-sensitive.
 */
function flipPathCase(p: string): string | null {
  const drive = /^[a-zA-Z]:/.exec(p);
  const start = drive ? drive[0].length : 0;
  // Scan from the end so we flip a leaf letter when present, an ancestor's
  // otherwise; index directly into `p`, so trailing slashes don't shift it.
  for (let i = p.length - 1; i >= start; i--) {
    const c = p[i]!;
    if (c >= "a" && c <= "z") return p.slice(0, i) + c.toUpperCase() + p.slice(i + 1);
    if (c >= "A" && c <= "Z") return p.slice(0, i) + c.toLowerCase() + p.slice(i + 1);
  }
  return null;
}

/**
 * Best-effort: is the filesystem backing `path` case-insensitive? Probes the
 * nearest existing ancestor by case-flipping a letter and checking whether the
 * variant resolves to the same inode. Defaults to false (case-sensitive)
 * whenever it can't tell — merging two distinct projects into one store (data
 * loss) is worse than keeping separate stores for the same dir reached via
 * different casing.
 */
function isCaseInsensitiveFs(path: string): boolean {
  let probe = path;
  while (probe && !existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  if (!probe || !existsSync(probe)) return false;

  const cached = caseInsensitiveCache.get(probe);
  if (cached !== undefined) return cached;

  let result = false;
  const flipped = flipPathCase(probe);
  if (flipped) {
    try {
      const a = statSync(probe);
      const b = statSync(flipped);
      result = a.dev === b.dev && a.ino === b.ino;
    } catch {
      result = false; // case-flipped variant doesn't exist → case-sensitive
    }
  }
  caseInsensitiveCache.set(probe, result);
  return result;
}

/**
 * Encode a working directory into a filesystem-safe, collision-resistant folder
 * name for the per-project memory layout. A readable, byte-bounded slug is
 * suffixed with a short hash of the normalized path, so distinct directories
 * that would slugify to the same string — e.g. `/a/b` and `/a-b`, both `a-b` —
 * never share a store. On a case-insensitive filesystem the path is case-folded
 * first, so `C:\Proj` and `c:\proj` map to one store; on a case-sensitive
 * filesystem (incl. case-sensitive macOS volumes) case is preserved so distinct
 * projects never merge. e.g. `C:\Users\x\proj` → `c-users-x-proj-1a2b3c4d`.
 */
export function encodeProjectPath(cwd: string): string {
  let key = cwd.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  if (isCaseInsensitiveFs(cwd)) key = key.toLowerCase();

  const hash = createHash("sha256").update(key).digest("hex").slice(0, 8);
  const slug = truncateToBytes(
    key.replace(/[/:]+/g, "-").replace(/^-+|-+$/g, ""),
    MAX_SLUG_BYTES,
  ).replace(/-+$/g, "");
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
