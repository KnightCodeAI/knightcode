// TODO: MCP-provided skills (a server advertising slash-command-style skills)
// are gated off and not ported. Inert: a memoized fetcher that returns no
// skills for any server. Memoized to match the cache-clearing call sites.

import memoize from 'lodash-es/memoize.js'
import type { Command } from '../commands.js'
import type { MCPServerConnection } from '../services/mcp/types.js'

export const fetchMcpSkillsForClient = memoize(
  async (_client: MCPServerConnection): Promise<Command[]> => [],
  client => client.name,
)
