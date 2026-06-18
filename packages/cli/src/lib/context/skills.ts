import { join } from "path";
import { homedir } from "os";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import {
  getProjectDirsUpToRoot,
  processFileWithIncludes,
  stripHtmlComments,
} from "./file-discovery";
import { getBundledSkills } from "./skills/bundled";

// Memoize the (FS-scanning) skill list per resolved cwd. The discovery provider
// and buildSkillIndex hit this every turn; the watcher (lib/context/skills/
// watcher.ts) calls clearSkillCaches() when a SKILL.md changes so edits appear
// without a restart.
const skillListCache = new Map<string, Skill[]>();

/** Drop all memoized skill lists — called by the skill-dir watcher on change. */
export function clearSkillCaches(): void {
  skillListCache.clear();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillSource = "global" | "project" | "bundled";

export type Skill = {
  name: string;
  description: string;
  argumentHint?: string;
  arguments?: string[];
  whenToUse?: string;
  allowedTools?: string[];
  agent?: string;
  shell?: string;
  context?: "fork";
  paths?: string[];
  userInvocable: boolean;
  disableModelInvocation: boolean;
  body: string;
  source: SkillSource;
  dirPath: string;
  getDynamicBody?: (
    args?: string,
    sessionId?: string,
  ) => Promise<string> | string;
};

type SkillFrontmatter = {
  name?: string;
  description?: string;
  "argument-hint"?: string;
  arguments?: string[];
  when_to_use?: string;
  "allowed-tools"?: string[];
  agent?: string;
  shell?: string;
  context?: string;
  paths?: string[];
  "user-invocable"?: boolean;
  "disable-model-invocation"?: boolean;
};

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

function parseSkillFrontmatter(raw: string): {
  meta: SkillFrontmatter;
  body: string;
} {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
    return { meta: {}, body: raw };
  }

  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { meta: {}, body: raw };

  const yaml = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const meta: SkillFrontmatter = {};

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
      if (key === "allowed-tools") meta["allowed-tools"] = items;
      if (key === "arguments") meta.arguments = items;
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
      if (items.length > 0) {
        if (key === "allowed-tools") meta["allowed-tools"] = items;
        if (key === "arguments") meta.arguments = items;
        if (key === "paths") meta.paths = items;
      }
      continue;
    }

    // Strip quotes
    val = val.replace(/^["']|["']$/g, "");
    if (key === "name") meta.name = val;
    else if (key === "description") meta.description = val;
    else if (key === "argument-hint") meta["argument-hint"] = val;
    else if (key === "when_to_use") meta["when_to_use"] = val;
    else if (key === "agent") meta.agent = val;
    else if (key === "shell") meta.shell = val;
    else if (key === "context") meta.context = val;
    else if (key === "disable-model-invocation") {
      meta["disable-model-invocation"] = val === "true";
    } else if (key === "user-invocable") {
      meta["user-invocable"] = val !== "false";
    }
  }

  return { meta, body };
}

// ---------------------------------------------------------------------------
// Skill directory scanning
// ---------------------------------------------------------------------------

function listSkillDirs(rootDir: string): string[] {
  if (!existsSync(rootDir)) return [];
  try {
    return readdirSync(rootDir)
      .map((name) => join(rootDir, name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

function parseSkill(
  dirPath: string,
  source: SkillSource,
  processedPaths: Set<string>,
): Skill | null {
  const skillFile = join(dirPath, "SKILL.md");
  if (!existsSync(skillFile)) return null;

  try {
    const raw = readFileSync(skillFile, "utf-8");
    const { meta, body: rawBody } = parseSkillFrontmatter(raw);
    const dirName = dirPath.split(/[\\/]/).pop()!;
    const name = meta.name ?? dirName;

    // description is required — skip malformed skills
    if (!meta.description) return null;

    // Process @include directives and HTML comment stripping
    const processedBody = processFileWithIncludes(skillFile, processedPaths);
    const finalBody = processedBody || stripHtmlComments(rawBody).content;

    return {
      name,
      description: meta.description,
      argumentHint: meta["argument-hint"],
      arguments: meta.arguments,
      whenToUse: meta["when_to_use"],
      allowedTools: meta["allowed-tools"],
      agent: meta.agent,
      shell: meta.shell,
      context: meta.context === "fork" ? "fork" : undefined,
      paths: meta.paths,
      userInvocable: meta["user-invocable"] !== false,
      disableModelInvocation: Boolean(meta["disable-model-invocation"]),
      body: finalBody.trim(),
      source,
      dirPath,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all installed skills using hierarchical directory traversal:
 *
 * 1. Global skills: ~/.knightcode/skills/<skill-name>/SKILL.md
 * 2. Project skills: .knightcode/skills/<skill-name>/SKILL.md at every
 *    directory from git root down to CWD
 *
 * Project skills override global skills with the same name.
 * Same physical file is loaded only once (deduplication by path).
 */
export function listSkills(cwd = process.cwd()): Skill[] {
  const cached = skillListCache.get(cwd);
  if (cached) return cached;

  const skills = new Map<string, Skill>();
  const seenDirs = new Set<string>();

  // 1. Load bundled skills first (lowest priority)
  for (const s of getBundledSkills()) {
    skills.set(s.name, s);
  }

  const globalDir = join(homedir(), ".knightcode", "skills");
  const projectDirs = getProjectDirsUpToRoot("skills", cwd);

  // 2. Load global skills next
  for (const dir of listSkillDirs(globalDir)) {
    const normalized = dir.replace(/\\/g, "/").toLowerCase();
    if (seenDirs.has(normalized)) continue;
    seenDirs.add(normalized);

    const s = parseSkill(dir, "global", new Set<string>());
    if (s) skills.set(s.name, s);
  }

  // 3. Load project skills — from least specific to most specific (root → CWD)
  //    so closer-to-CWD skills override parent ones
  for (const skillsDir of [...projectDirs].reverse()) {
    for (const dir of listSkillDirs(skillsDir)) {
      const normalized = dir.replace(/\\/g, "/").toLowerCase();
      if (seenDirs.has(normalized)) continue;
      seenDirs.add(normalized);

      const s = parseSkill(dir, "project", new Set<string>());
      if (s) skills.set(s.name, s); // project overrides global & parent
    }
  }

  const result = Array.from(skills.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  skillListCache.set(cwd, result);
  return result;
}

/**
 * Load a skill's full body by name. Returns null if not found.
 */
export function loadSkill(name: string, cwd = process.cwd()): Skill | null {
  return listSkills(cwd).find((s) => s.name === name) ?? null;
}

/** A glob that matches everything — treated as "no path scoping". */
function isMatchAllGlob(g: string): boolean {
  const n = g.trim();
  return n === "" || n === "**" || n === "**/*" || n === "*";
}

/**
 * A "conditional" skill has `paths` frontmatter scoping it to matching files
 * (mirrors claude-code's path-conditional skills). These are kept OUT of the
 * always-on skill index and user-text discovery — they surface only when the
 * model touches a file matching their globs (see skills/conditional.ts).
 */
export function isConditionalSkill(s: Skill): boolean {
  return (
    !s.disableModelInvocation &&
    Array.isArray(s.paths) &&
    s.paths.some((g) => !isMatchAllGlob(g))
  );
}

/** Max chars of a single skill's description in the index listing. */
export const MAX_LISTING_DESC_CHARS = 250;
/** Max total chars of the rendered skill index (keeps turn-1 tokens bounded). */
export const SKILL_INDEX_CHAR_BUDGET = 8000;

/** Shortest meaningful truncated description; below this we go names-only. */
const MIN_DESC_CHARS = 20;

function clampDesc(desc: string, cap = MAX_LISTING_DESC_CHARS): string {
  const flat = desc.replace(/\s+/g, " ").trim();
  return flat.length > cap ? flat.slice(0, cap - 1).trimEnd() + "…" : flat;
}

/** `description` joined with the whenToUse hint, the way it appears in a listing. */
function combinedDesc(s: Skill): string {
  return s.whenToUse ? `${s.description} — Use when: ${s.whenToUse}` : s.description;
}

function skillEntries(skills: Skill[], descCap: number): string[] {
  return skills.map((s) => `- **${s.name}** — ${clampDesc(combinedDesc(s), descCap)}`);
}

/** Char length of the listing once newline-joined. */
function joinedLength(lines: string[]): number {
  return lines.reduce((n, l) => n + l.length, 0) + Math.max(0, lines.length - 1);
}

/**
 * Build the skill index for system prompt injection — model-invokable skills only.
 *
 * The listing is bounded to SKILL_INDEX_CHAR_BUDGET but **never drops a skill**:
 * a dropped name is undiscoverable (the model can't load what it can't see), so
 * like claude-code's `formatCommandsWithinBudget` we degrade gracefully —
 * full descriptions → uniformly truncated descriptions → names-only — always
 * listing every eligible skill. Returns "" when no eligible skills exist.
 */
export function buildSkillIndex(cwd = process.cwd()): string {
  const skills = listSkills(cwd).filter(
    (s) => !s.disableModelInvocation && !isConditionalSkill(s),
  );
  if (skills.length === 0) return "";

  // 1. Full descriptions (each capped at MAX_LISTING_DESC_CHARS) if they fit.
  const full = skillEntries(skills, MAX_LISTING_DESC_CHARS);
  if (joinedLength(full) <= SKILL_INDEX_CHAR_BUDGET) return full.join("\n");

  const namesOnly = skills.map((s) => `- **${s.name}**`);

  // 2. Otherwise compute a per-entry description cap that fits all names, and
  //    truncate every description to it. Reserve the names+markup overhead first.
  const nameOverhead = joinedLength(namesOnly) + skills.length * 3; // 3 ≈ " — " per entry
  const perEntryDescBudget = Math.floor(
    (SKILL_INDEX_CHAR_BUDGET - nameOverhead) / skills.length,
  );
  if (perEntryDescBudget >= MIN_DESC_CHARS) {
    const truncated = skillEntries(skills, perEntryDescBudget);
    if (joinedLength(truncated) <= SKILL_INDEX_CHAR_BUDGET) {
      return truncated.join("\n");
    }
  }

  // 3. Floor: names only. Never hides a skill (may exceed budget only when the
  //    bare name list itself does, which would take hundreds of skills).
  return namesOnly.join("\n");
}
