// TODO: subagent context tracking lands with the harness phase.

export function getAgentContext(): undefined {
  return undefined
}

// TODO: subagent context tracking lands with the Agent tool; pass-through.
export type SubagentContext = { agentId: string; parentSessionId?: string; agentType: 'subagent'; subagentName?: string; isBuiltIn?: boolean }
export function runWithAgentContext<T>(_context: unknown, fn: () => T): T { return fn() }
