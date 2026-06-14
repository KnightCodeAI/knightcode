// TODO: agent discovery (built-in, user, and project agent files) is not
// implemented yet; only the definition type the API layer references lives
// here.
import type { SettingSource } from '../../utils/settings/constants.js'
import type { ToolUseContext } from '../../Tool.js'

export type AgentDefinition = {
  agentType: string
  whenToUse: string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  /** Memory scope this agent's notes are stored under, when it has memory. */
  memory?: 'user' | 'project' | 'local'
  /** Where the agent was defined: built-in registry, a settings source, or a
   *  plugin. */
  source: SettingSource | 'built-in' | 'plugin'
  /** Resolves the agent's system prompt. Built-in agents take a context arg;
   *  custom/plugin agents take none — the optional param accepts both. */
  getSystemPrompt: (params?: {
    toolUseContext: Pick<ToolUseContext, 'options'>
  }) => string
  [key: string]: unknown
}

export type AgentDefinitionsResult = {
  activeAgents: AgentDefinition[]
  allAgents: AgentDefinition[]
  failedFiles?: Array<{ path: string; error: string }>
  allowedAgentTypes?: string[]
}

// TODO: MCP-requirement filtering lands with the MCP layer. With no MCP servers
// connected, agents are not filtered by server availability.
export function filterAgentsByMcpRequirements(
  agents: AgentDefinition[],
  _availableServers: string[],
): AgentDefinition[] {
  return agents
}

// An agent is built-in when its source is the built-in registry (vs a user- or
// project-defined agent file).
export function isBuiltInAgent(agent: AgentDefinition): boolean {
  return agent.source === 'built-in'
}
