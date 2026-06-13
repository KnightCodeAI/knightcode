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
