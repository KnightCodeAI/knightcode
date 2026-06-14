import memoize from 'lodash-es/memoize.js'
// TODO: agent discovery (built-in, user, and project agent files) is not
// implemented yet; only the definition type the API layer references lives
// here.
import type { SettingSource } from '../../utils/settings/constants.js'
import type { ToolUseContext } from '../../Tool.js'
import type { AgentColorName } from './agentColorManager.js'
import type { AgentMemoryScope } from './agentMemory.js'
import type { EffortValue } from '../../utils/effort.js'
import type { PermissionMode } from '../../types/permissions.js'
import type { HooksSettings } from '../../schemas/hooks.js'

// A reference to an MCP server by name, or an inline definition.
export type AgentMcpServerSpec =
  | string
  | { [name: string]: Record<string, unknown> }

// Base type with common fields for all agents
export type BaseAgentDefinition = {
  agentType: string
  whenToUse: string
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[] // Skill names to preload
  mcpServers?: AgentMcpServerSpec[] // MCP servers specific to this agent
  hooks?: HooksSettings // Session-scoped hooks registered when agent starts
  color?: AgentColorName
  model?: string
  effort?: EffortValue
  permissionMode?: PermissionMode
  maxTurns?: number // Maximum number of agentic turns before stopping
  filename?: string // Original filename without .md extension
  baseDir?: string
  criticalSystemReminder_EXPERIMENTAL?: string // Re-injected at every user turn
  requiredMcpServers?: string[] // MCP server name patterns that must be configured
  background?: boolean // Always run as background task when spawned
  initialPrompt?: string // Prepended to the first user turn
  memory?: AgentMemoryScope // Persistent memory scope
  isolation?: 'worktree' | 'remote' // Run in an isolated git worktree, or remotely
  pendingSnapshotUpdate?: { snapshotTimestamp: string }
  /** Omit CLAUDE.md hierarchy from the agent's userContext. Read-only agents
   * (Explore, Plan) don't need commit/PR/lint guidelines — the main agent has
   * full CLAUDE.md and interprets their output. */
  omitClaudeMd?: boolean
  serverName?: string
  requiredMcpServersText?: string
  overriddenBy?: SettingSource | 'built-in' | 'plugin'
  location?: SettingSource | 'built-in' | 'plugin'
}

// Built-in agents - dynamic prompts only, no static systemPrompt field
export type BuiltInAgentDefinition = BaseAgentDefinition & {
  source: 'built-in'
  baseDir: 'built-in'
  callback?: () => void
  getSystemPrompt: (params: {
    toolUseContext: Pick<ToolUseContext, 'options'>
  }) => string
}

// Custom agents from user/project/policy settings - prompt stored via closure
export type CustomAgentDefinition = BaseAgentDefinition & {
  getSystemPrompt: () => string
  source: SettingSource
  filename?: string
  baseDir?: string
}

// Plugin agents - similar to custom but with plugin metadata
export type PluginAgentDefinition = BaseAgentDefinition & {
  getSystemPrompt: () => string
  source: 'plugin'
  filename?: string
  plugin: string
}

// Union type for all agent types
export type AgentDefinition =
  | BuiltInAgentDefinition
  | CustomAgentDefinition
  | PluginAgentDefinition

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

// Type guards for runtime type checking
export function isBuiltInAgent(
  agent: AgentDefinition,
): agent is BuiltInAgentDefinition {
  return agent.source === 'built-in'
}

export function isCustomAgent(
  agent: AgentDefinition,
): agent is CustomAgentDefinition {
  return agent.source !== 'built-in' && agent.source !== 'plugin'
}

export function isPluginAgent(
  agent: AgentDefinition,
): agent is PluginAgentDefinition {
  return agent.source === 'plugin'
}

// TODO: MCP-requirement gating lands with the MCP layer. With no MCP servers
// configured, an agent's requiredMcpServers are treated as satisfied.
export function hasRequiredMcpServers(
  _agent: AgentDefinition,
  _availableServers: string[],
): boolean {
  return true
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
