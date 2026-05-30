import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import type { AgentDefinition } from "./types";
import { BUILT_IN_AGENTS } from "./built-in";

/** Parse comma- or newline-separated tool lists from frontmatter. */
function parseToolList(raw: unknown): string[] | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return raw
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Minimal YAML frontmatter parser: `key: value` lines between leading `---`. */
function parseFrontmatter(text: string): {
  frontmatter: Record<string, string>;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { frontmatter: {}, body: text };
  const frontmatter: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    frontmatter[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { frontmatter, body: match[2] ?? "" };
}

function parseCustomAgent(filePath: string): AgentDefinition | null {
  const { frontmatter, body } = parseFrontmatter(readFileSync(filePath, "utf-8"));
  const name = frontmatter["name"];
  const description = frontmatter["description"];
  if (!name || !description) return null; // not an agent file
  const systemPrompt = body.trim();
  const modelRaw = frontmatter["model"]?.trim();
  const maxTurnsRaw = frontmatter["maxTurns"];
  return {
    agentType: name,
    whenToUse: description,
    tools: parseToolList(frontmatter["tools"]),
    disallowedTools: parseToolList(frontmatter["disallowedTools"]),
    model: modelRaw && modelRaw.length > 0 ? modelRaw : undefined,
    maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) || undefined : undefined,
    background: frontmatter["background"] === "true" ? true : undefined,
    source: "project",
    getSystemPrompt: () => systemPrompt,
  };
}

const cache = new Map<string, AgentDefinition[]>();

export function loadAgents(projectRoot: string): AgentDefinition[] {
  const cached = cache.get(projectRoot);
  if (cached) return cached;
  const byType = new Map<string, AgentDefinition>();
  for (const a of BUILT_IN_AGENTS) byType.set(a.agentType, a);
  const dir = join(projectRoot, ".knightcode", "agents");
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      try {
        const agent = parseCustomAgent(join(dir, file));
        if (agent) byType.set(agent.agentType, agent); // custom overrides built-in
      } catch {
        // skip malformed file
      }
    }
  }
  const list = Array.from(byType.values());
  cache.set(projectRoot, list);
  return list;
}

export function clearAgentCache(): void {
  cache.clear();
}

export function getAgent(
  agents: AgentDefinition[],
  agentType: string,
): AgentDefinition | undefined {
  return agents.find((a) => a.agentType === agentType);
}

/** Resolve the effective tool name list for an agent against the available pool. */
export function resolveAgentTools(
  agent: AgentDefinition,
  available: string[],
): string[] {
  const hasAllow =
    agent.tools && agent.tools.length > 0 && !agent.tools.includes("*");
  const deny = new Set(agent.disallowedTools ?? []);
  let result = hasAllow
    ? agent.tools!.filter((t) => available.includes(t))
    : available.slice();
  if (deny.size > 0) result = result.filter((t) => !deny.has(t));
  return result;
}

/** Render the "Available agent types" block for the system prompt. */
export function formatAgentLines(
  agents: AgentDefinition[],
  available: string[],
): string {
  return agents
    .map((a) => {
      const tools =
        a.tools?.includes("*") || !a.tools
          ? "All tools"
          : resolveAgentTools(a, available).join(", ");
      const deny = a.disallowedTools?.length
        ? ` (except ${a.disallowedTools.join(", ")})`
        : "";
      return `- ${a.agentType}: ${a.whenToUse} (Tools: ${tools}${deny})`;
    })
    .join("\n");
}
