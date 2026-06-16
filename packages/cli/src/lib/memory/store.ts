import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { getMemoryDir, getMemoryIndexPath } from "./paths";
import {
  MEMORY_TYPES,
  scanMemoryFiles,
  stripFrontmatter,
  type MemoryType,
} from "./scan";

/** Normalize a memory name (or filename) into its on-disk slug. */
export function slugifyMemoryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Rewrite MEMORY.md from the current memory files (one line per memory). */
export function regenerateMemoryIndex(cwd: string): void {
  const headers = scanMemoryFiles(cwd);
  const lines = ["# Memory Index", ""];
  for (const h of headers) {
    const hook = h.description ? ` — ${h.description}` : "";
    lines.push(`- [${h.name}](${h.filename})${hook}`);
  }
  writeFileSync(getMemoryIndexPath(cwd), lines.join("\n") + "\n", "utf-8");
}

export type MemoryUpsert = {
  name: string;
  description?: string;
  type: MemoryType;
  body: string;
};

/**
 * Create or overwrite a memory file (and refresh the index). Returns true when
 * a file was written, false on a byte-identical no-op or invalid input — so a
 * re-save of unchanged content doesn't churn the file or bump its mtime (which
 * would skew recency-based recall ordering).
 */
export function upsertMemory(cwd: string, item: MemoryUpsert): boolean {
  const slug = slugifyMemoryName(item.name);
  const body = item.body.trim();
  if (
    !slug ||
    !body ||
    !(MEMORY_TYPES as readonly string[]).includes(item.type)
  ) {
    return false;
  }
  const dir = getMemoryDir(cwd);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${slug}.md`);
  if (existsSync(path)) {
    try {
      if (stripFrontmatter(readFileSync(path, "utf-8")).trim() === body) {
        return false;
      }
    } catch {
      // fall through and overwrite
    }
  }
  // YAML-safe: collapse newlines and JSON-quote so colons/quotes/# in the
  // description can't corrupt the frontmatter (scan.ts parses quoted scalars).
  const safeDescription = JSON.stringify(
    (item.description ?? "").replace(/[\r\n]+/g, " ").trim(),
  );
  const content = `---\nname: ${slug}\ndescription: ${safeDescription}\nmetadata:\n  type: ${item.type}\n---\n\n${body}\n`;
  writeFileSync(path, content, "utf-8");
  regenerateMemoryIndex(cwd);
  return true;
}

/** Read a memory's full body by name/slug. Null if not found. */
export function readMemoryBody(cwd: string, name: string): string | null {
  const slug = slugifyMemoryName(name);
  if (!slug) return null;
  const path = join(getMemoryDir(cwd), `${slug}.md`);
  if (!existsSync(path)) return null;
  try {
    return stripFrontmatter(readFileSync(path, "utf-8")).trim();
  } catch {
    return null;
  }
}

/** Delete a memory by name/slug and refresh the index. False if not found. */
export function deleteMemory(cwd: string, name: string): boolean {
  const slug = slugifyMemoryName(name);
  if (!slug) return false;
  const path = join(getMemoryDir(cwd), `${slug}.md`);
  if (!existsSync(path)) return false;
  rmSync(path);
  regenerateMemoryIndex(cwd);
  return true;
}
