import memoize from 'lodash-es/memoize.js'
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
  // Optional display/config fields read by the agent-management UI. The runtime
  // that fully populates custom/plugin agents lands with the agent subsystem.
  skills?: string[]
  hooks?: Record<string, unknown>
  color?: string
  permissionMode?: import('../../types/permissions.js').PermissionMode
  effort?: import('../../utils/effort.js').EffortValue
  filename?: string
  baseDir?: string
  plugin?: string
  serverName?: string
  requiredMcpServers?: string[]
  overriddenBy?: SettingSource | 'built-in' | 'plugin'
  location?: SettingSource | 'built-in' | 'plugin'
  // Runtime fields the sub-agent execution engine reads. The reference splits
  // these across the built-in/custom/plugin union; the flat shape carries them
  // as optional until the full union lands.
  mcpServers?: Array<string | Record<string, Record<string, unknown>>>
  omitClaudeMd?: boolean
  maxTurns?: number
  criticalSystemReminder_EXPERIMENTAL?: string
  callback?: () => void
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

// Custom (user/project/policy) agents — modelled as the flat AgentDefinition.
// The reference splits built-in/custom/plugin into a discriminated union; the
// BYOK build keeps one shape and discriminates on `source`.
export type CustomAgentDefinition = AgentDefinition

export function isCustomAgent(agent: AgentDefinition): boolean {
  return agent.source !== 'built-in' && agent.source !== 'plugin'
}

export function isPluginAgent(agent: AgentDefinition): boolean {
  return agent.source === 'plugin'
}

// Collapse a flat agent list to the active set: later sources override earlier
// ones by agentType, in built-in → plugin → user → project → flag → policy order.
export function getActiveAgentsFromList(
  allAgents: AgentDefinition[],
): AgentDefinition[] {
  const order = [
    'built-in',
    'plugin',
    'userSettings',
    'projectSettings',
    'flagSettings',
    'policySettings',
  ]
  const agentMap = new Map<string, AgentDefinition>()
  for (const source of order) {
    for (const agent of allAgents.filter(a => a.source === source)) {
      agentMap.set(agent.agentType, agent)
    }
  }
  return Array.from(agentMap.values())
}

export const getAgentDefinitionsWithOverrides = memoize(
  (..._args: any[]): any => ({ allAgents: [], builtInAgents: [], userAgents: [] }),
)

export function clearAgentDefinitionsCache(): void {}
