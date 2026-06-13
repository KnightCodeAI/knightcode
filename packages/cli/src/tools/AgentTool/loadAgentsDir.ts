// TODO: agent discovery (built-in, user, and project agent files) lands
// with the subagent phase; only the definition type the API layer
// references lives here.

export type AgentDefinition = {
  agentType: string
  whenToUse: string
  tools?: string[]
  disallowedTools?: string[]
  model?: string
  [key: string]: unknown
}

export type AgentDefinitionsResult = {
  activeAgents: AgentDefinition[]
  allAgents: AgentDefinition[]
  failedFiles?: Array<{ path: string; error: string }>
  allowedAgentTypes?: string[]
}
