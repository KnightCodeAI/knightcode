// TODO: agent discovery (built-in, user, and project agent files) is not
// implemented yet; only the definition type the API layer references lives
// here.

export type AgentDefinition = {
  agentType: string
  whenToUse: string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  /** Memory scope this agent's notes are stored under, when it has memory. */
  memory?: 'user' | 'project' | 'local'
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
