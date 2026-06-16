import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { basename, join } from "path";
import { getMemoryDir, getMemoryIndexPath } from "./paths";

export const MEMORY_TYPES = [
  "user",
  "feedback",
  "project",
  "reference",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export type MemoryHeader = {
  /** File name including extension, e.g. "no-coauthored-by-trailer.md". */
  filename: string;
  filePath: string;
  name: string;
  description: string;
  type?: MemoryType;
  mtimeMs: number;
};

const MAX_MEMORY_FILES = 200;
const MAX_INDEX_LINES = 200;
const MAX_INDEX_BYTES = 25_000;

/**
 * Parse the minimal frontmatter knightcode memory files use:
 *   ---
 *   name: <slug>
 *   description: <one line>
 *   metadata:
 *     type: user | feedback | project | reference
 *   ---
 */
/** Parse a YAML scalar: JSON-decode double-quoted strings, else strip quotes. */
function parseScalar(raw: string): string {
  if (raw.startsWith('"')) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string") return parsed;
    } catch {
      // fall through to quote-stripping
    }
  }
  return raw.replace(/^["']|["']$/g, "");
}

export function parseMemoryFrontmatter(raw: string): {
  name?: string;
  description?: string;
  type?: MemoryType;
} {
  const result: { name?: string; description?: string; type?: MemoryType } = {};
  if (!raw.startsWith("---")) return result;
  const firstNl = raw.indexOf("\n");
  const end = raw.indexOf("\n---", firstNl);
  if (firstNl === -1 || end === -1) return result;

  const yaml = raw.slice(firstNl + 1, end);
  let inMetadata = false;
  for (const line of yaml.split("\n")) {
    const top = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (top) {
      const key = top[1]!;
      const rawVal = top[2]!.trim();
      const val = parseScalar(rawVal);
      if (key === "name") result.name = val;
      else if (key === "description") result.description = val;
      inMetadata = key === "metadata" && rawVal === "";
      continue;
    }
    if (inMetadata) {
      const nested = line.match(/^\s+type:\s*(.*)$/);
      if (nested) {
        const t = nested[1]!.trim().replace(/^["']|["']$/g, "");
        if ((MEMORY_TYPES as readonly string[]).includes(t)) {
          result.type = t as MemoryType;
        }
      }
    }
  }
  return result;
}

/** Strip a leading `--- … ---` frontmatter block, returning the body. */
export function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---")) return raw;
  const firstNl = raw.indexOf("\n");
  const end = raw.indexOf("\n---", firstNl);
  if (firstNl === -1 || end === -1) return raw;
  return raw.slice(end + 4).replace(/^\r?\n/, "");
}

/**
 * Scan the project memory dir for `.md` files (excluding MEMORY.md), read their
 * frontmatter headers, and return them newest-first, capped at 200. Empty array
 * when the dir doesn't exist — callers skip the side query in that case.
 */
export function scanMemoryFiles(cwd: string): MemoryHeader[] {
  const dir = getMemoryDir(cwd);
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const headers: MemoryHeader[] = [];
  for (const filename of entries) {
    if (!filename.endsWith(".md") || filename === "MEMORY.md") continue;
    const filePath = join(dir, filename);
    try {
      const stats = statSync(filePath);
      if (!stats.isFile()) continue;
      const meta = parseMemoryFrontmatter(readFileSync(filePath, "utf-8"));
      headers.push({
        filename,
        filePath,
        name: meta.name ?? basename(filename, ".md"),
        description: meta.description ?? "",
        type: meta.type,
        mtimeMs: stats.mtimeMs,
      });
    } catch {
      // skip unreadable/garbage files
    }
  }
  headers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return headers.slice(0, MAX_MEMORY_FILES);
}

/**
 * Read MEMORY.md (the index loaded into the system prompt), truncated to the
 * line and byte caps. Returns undefined when there is no index yet.
 */
export function readMemoryIndex(cwd: string): string | undefined {
  const path = getMemoryIndexPath(cwd);
  if (!existsSync(path)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8").trim();
  } catch {
    return undefined;
  }
  if (!raw) return undefined;

  const lines = raw.split("\n");
  let out = lines.length > MAX_INDEX_LINES ? lines.slice(0, MAX_INDEX_LINES) : lines;
  let text = out.join("\n");
  if (text.length > MAX_INDEX_BYTES) {
    text = text.slice(0, MAX_INDEX_BYTES);
    const lastNl = text.lastIndexOf("\n");
    if (lastNl > 0) text = text.slice(0, lastNl);
  }
  return text;
}
