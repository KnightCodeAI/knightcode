import { dirname, join, relative, resolve } from "path";
import { homedir } from "os";
import { existsSync, readFileSync } from "fs";
import {
  findGitRoot,
  getProjectDirsUpToRoot,
  listMarkdownFilesRecursive,
  processFileWithIncludes,
  stripHtmlComments,
} from "./file-discovery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RuleSource = "global" | "project";

export type Rule = {
  name: string;
  description?: string;
  paths?: string[];
  body: string;
  source: RuleSource;
  filePath: string;
};

type Frontmatter = {
  name?: string;
  description?: string;
  paths?: string[];
};

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * Minimal YAML frontmatter parser — handles flat scalar keys and
 * inline/block arrays. Robust enough for rule metadata.
 */
function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { meta: {}, body: raw };
  }

  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: raw };

  const yaml = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const meta: Frontmatter = {};

  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!.trim();

    // Inline array: [a, b, c]
    if (val.startsWith("[") && val.endsWith("]")) {
      const items = val
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      if (key === "paths") meta.paths = items;
      continue;
    }

    // Block array (next lines start with "- ")
    if (val === "") {
      const items: string[] = [];
      while (i + 1 < lines.length && lines[i + 1]!.match(/^\s*-\s+/)) {
        i++;
        items.push(
          lines[i]!.replace(/^\s*-\s+/, "").replace(/^["']|["']$/g, ""),
        );
      }
      if (items.length > 0 && key === "paths") meta.paths = items;
      continue;
    }

    // Strip quotes
    val = val.replace(/^["']|["']$/g, "");
    if (key === "name") meta.name = val;
    if (key === "description") meta.description = val;
  }

  return { meta, body };
}

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

/**
 * Convert a glob string to a regex. Supports **, *, and ?.
 * Stays Windows/POSIX-agnostic by normalizing separators.
 */
function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i]!;
    if (c === "*") {
      if (normalized[i + 1] === "*") {
        re += "GLOBSTAR";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "[") {
      re += "[";
      if (normalized[i + 1] === "!") {
        re += "^";
        i++;
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (/[.+^${}()|\\]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }

  // Replace double asterisks (globstar) placeholders in the escaped string
  // 1. leading GLOBSTAR/ -> optional prefix folder depth
  if (re.startsWith("GLOBSTAR/")) {
    re = "(?:.*/)?" + re.slice(9);
  }
  // 2. trailing /GLOBSTAR -> optional suffix folder depth
  if (re.endsWith("/GLOBSTAR")) {
    re = re.slice(0, -9) + "(?:/.*)?";
  }
  // 3. /GLOBSTAR/ -> optional middle folder depth
  re = re.replace(/\/GLOBSTAR\//g, "/(?:.*/)?");
  // 4. Any remaining GLOBSTAR -> matches anything
  re = re.replace(/GLOBSTAR/g, ".*");

  return new RegExp("^" + re + "$");
}

function matchesAnyPath(globs: string[], cwd: string): boolean {
  const gitRoot = findGitRoot(cwd) || cwd;
  const relativeCwd = relative(gitRoot, cwd).replace(/\\/g, "/");
  const normalizedCwd = cwd.replace(/\\/g, "/");

  // Also try matching against paths relative to ancestor directories that
  // contain a .knightcode/ directory. These are the natural "project roots"
  // for rule globs like `src/**`.

  const projectRelatives: string[] = [];
  let current = resolve(cwd);
  while (true) {
    const parent = dirname(current);
    if (parent === current) break;
    const knightcodeDir = join(parent, ".knightcode");
    try {
      if (existsSync(knightcodeDir)) {
        const rel = relative(parent, cwd).replace(/\\/g, "/");
        if (rel && !rel.startsWith("..")) {
          projectRelatives.push(rel);
        }
      }
    } catch {}
    // Stop at the git root to avoid walking too far up
    const normalizeForCompare = (p: string) => {
      const n = resolve(p).replace(/\\/g, "/");
      return process.platform === "win32" ? n.toLowerCase() : n;
    };
    if (normalizeForCompare(parent) === normalizeForCompare(gitRoot)) break;
    current = parent;
  }

  return globs.some((g) => {
    const regex = globToRegex(g);
    if (regex.test(relativeCwd) || regex.test(normalizedCwd)) return true;
    return projectRelatives.some((rel) => regex.test(rel));
  });
}

// ---------------------------------------------------------------------------
// Rule file parsing
// ---------------------------------------------------------------------------

function parseRuleFile(
  filePath: string,
  source: RuleSource,
  processedPaths: Set<string>,
): Rule | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const { meta, body: rawBody } = parseFrontmatter(raw);

    // Process @include directives and strip HTML comments
    const processedBody = processFileWithIncludes(filePath, processedPaths);
    // If processFileWithIncludes already handled it, use that. Otherwise fall
    // back to stripping comments from the raw body.
    const finalBody = processedBody || stripHtmlComments(rawBody).content;

    const fileName = filePath.split(/[\\/]/).pop()!.replace(/\.md$/, "");
    return {
      name: meta.name ?? fileName,
      description: meta.description,
      paths: meta.paths,
      body: finalBody.trim(),
      source,
      filePath,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load all rules using hierarchical directory traversal:
 *
 * 1. Global rules: ~/.knightcode/rules/*.md
 * 2. Project rules: .knightcode/rules/*.md at every directory from git root
 *    down to CWD (recursive subdirectory scanning)
 *
 * Rules with `paths:` frontmatter are included only when cwd matches a glob.
 * Deduplication prevents the same physical file from loading twice.
 */
export function loadRules(cwd = process.cwd()): Rule[] {
  const globalDir = join(homedir(), ".knightcode", "rules");

  // 1. Global rules
  const globalFiles = listMarkdownFilesRecursive(globalDir);

  // 2. Project rules — hierarchical traversal from CWD up to git root
  const projectDirs = getProjectDirsUpToRoot("rules", cwd);

  // Collect files: global first, then project dirs (most specific last = highest priority)
  // Project dirs come back most-specific-first, so reverse for root→CWD ordering
  const fileSources: Array<[string, RuleSource]> = [];

  for (const fp of globalFiles) {
    fileSources.push([fp, "global"]);
  }
  for (const dir of [...projectDirs].reverse()) {
    for (const fp of listMarkdownFilesRecursive(dir)) {
      fileSources.push([fp, "project"]);
    }
  }

  // Deduplicate by normalized path
  const seenPaths = new Set<string>();
  const rules: Rule[] = [];

  for (const [filePath, source] of fileSources) {
    const normalized = filePath.replace(/\\/g, "/").toLowerCase();
    if (seenPaths.has(normalized)) continue;
    seenPaths.add(normalized);

    const rule = parseRuleFile(filePath, source, new Set<string>());
    if (!rule) continue;

    // Conditional path filtering
    if (
      rule.paths &&
      rule.paths.length > 0 &&
      !matchesAnyPath(rule.paths, cwd)
    ) {
      continue;
    }

    rules.push(rule);
  }

  return rules;
}

/**
 * Aggregate rule bodies into a single markdown string for system prompt injection.
 * Returns empty string if no rules apply.
 */
export function loadRulesText(cwd = process.cwd()): string {
  const rules = loadRules(cwd);
  if (rules.length === 0) return "";

  return rules
    .map((r) => {
      const header = `### ${r.name}${r.description ? ` — ${r.description}` : ""}`;
      return `${header}\n${r.body}`;
    })
    .join("\n\n");
}
