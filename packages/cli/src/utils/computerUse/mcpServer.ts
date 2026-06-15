// TODO: the in-process computer-use MCP server (gated off; native host
// packages) is not ported. Inert: only reached for a "computer-use" server,
// which is never matched here.

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

export async function createComputerUseMcpServerForCli(): Promise<{
  connect(t: Transport): Promise<void>
  close(): Promise<void>
}> {
  throw new Error('Computer-use MCP server is not supported')
}
