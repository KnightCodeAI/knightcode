// TODO: the KnightCode-in-Chrome in-process MCP server package is a private native
// dependency that is not ported. Inert stub for the `@ant/knightcode-for-chrome-mcp`
// import; only reached for a "knightcode-in-chrome" server, which is never matched.

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export function createKnightcodeForChromeMcpServer(_context: unknown): {
  connect(t: Transport): Promise<void>
  close(): Promise<void>
} {
  throw new Error('KnightCode-in-Chrome MCP server is not supported')
}
