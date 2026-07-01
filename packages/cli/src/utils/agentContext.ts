// TODO: subagent context tracking lands with the harness phase.

// TODO: subagent context tracking lands with the Agent tool; pass-through.
export type SubagentContext = { agentId: string; parentSessionId?: string; agentType: 'subagent'; subagentName?: string; isBuiltIn?: boolean }

export type AgentContext = {
  agentId: string
  parentSessionId?: string
  agentType: string
  agentName?: string
  teamName?: string
  agentColor?: string
  planModeRequired?: boolean
  isTeamLead?: boolean
  invokingRequestId?: string
  invocationKind?: string
  invocationEmitted?: boolean
  subagentName?: string
  isBuiltIn?: boolean
}

export function getAgentContext(): SubagentContext | undefined {
  return undefined
}

export function runWithAgentContext<T>(_context: unknown, fn: () => T): T { return fn() }
