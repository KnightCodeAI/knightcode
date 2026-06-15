// TODO: subagent memory directories aren't ported. This inert check lets the
// permission layer treat no path as an agent-memory path until they land.

import { homedir } from 'os'
import { join } from 'path'

export type AgentMemoryScope = 'user' | 'project' | 'local'

export function isAgentMemoryPath(_absolutePath: string): boolean {
  return false
}

// TODO: per-subagent memory storage isn't ported. Returns a stable directory
// for the given agent type so callers that compute the path can run; nothing
// reads or writes there until the subagent memory layer lands.
export function getAgentMemoryDir(
  agentType: string,
  _scope: AgentMemoryScope,
): string {
  const home = (
    process.env.KNIGHTCODE_CONFIG_DIR ?? join(homedir(), '.knightcode')
  ).normalize('NFC')
  return join(home, 'agent-memory', agentType)
}

// Human-readable label for an agent's memory scope, shown in the agent UI.
export function getMemoryScopeDisplay(memory: AgentMemoryScope | undefined): string {
  switch (memory) {
    case 'user':
      return 'User (~/.knightcode/agent-memory/)'
    case 'project':
      return 'Project (.knightcode/agent-memory/)'
    case 'local':
      return 'Local (.knightcode/agent-memory/)'
    default:
      return 'None'
  }
}

// TODO: persistent agent memory (dir creation + MEMORY.md read) lands with the
// agent-memory subsystem; until then no prior memory is injected.
export function loadAgentMemoryPrompt(_agentType: string, _scope: AgentMemoryScope): string {
  return ''
}
