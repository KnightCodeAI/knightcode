export type AgentSource = "built-in" | "project";

export interface AgentDefinition {
  /** Unique agent type, e.g. "general-purpose". */
  agentType: string;
  /** One-line "when to use" description shown to the model. */
  whenToUse: string;
  /** Tool allowlist. ["*"] or undefined means all tools. */
  tools?: string[];
  /** Tool denylist applied after the allowlist. */
  disallowedTools?: string[];
  /** Model override: "sonnet" | "opus" | "haiku" | "inherit" | undefined. */
  model?: string;
  /** Max agentic turns before the loop stops. */
  maxTurns?: number;
  /** Always run as a background task when spawned. */
  background?: boolean;
  /** Where this agent came from. */
  source: AgentSource;
  /** Resolve the agent's system prompt (markdown body for custom agents). */
  getSystemPrompt: () => string;
}

/** One-shot built-in agents that return a single report (no resume trailer). */
export const ONE_SHOT_AGENT_TYPES: ReadonlySet<string> = new Set([
  "Explore",
  "Plan",
]);

export const DEFAULT_AGENT_TYPE = "general-purpose";
