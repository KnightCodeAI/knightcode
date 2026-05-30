import { join } from "path";
import { homedir } from "os";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import {
  getProjectDirsUpToRoot,
  processFileWithIncludes,
  stripHtmlComments,
} from "./file-discovery";
import { getBundledSkills } from "./skills/bundled";

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

  return Array.from(skills.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

/**
 * Load a skill's full body by name. Returns null if not found.
 */
export function loadSkill(name: string, cwd = process.cwd()): Skill | null {
  return listSkills(cwd).find((s) => s.name === name) ?? null;
}

/**
 * Build the skill index for system prompt injection — model-invokable skills only.
 * Includes `whenToUse` hint when present.
 * Returns empty string when no eligible skills exist.
 */
export function buildSkillIndex(cwd = process.cwd()): string {
  const skills = listSkills(cwd).filter((s) => !s.disableModelInvocation);
  if (skills.length === 0) return "";
  return skills
    .map((s) => {
      let entry = `- **${s.name}** — ${s.description}`;
      if (s.whenToUse) entry += ` (Use when: ${s.whenToUse})`;
      return entry;
    })
    .join("\n");
}
