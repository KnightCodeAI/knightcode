// TODO: computer-use is gated off (the host package is not ported); the only
// surface other code needs is the reserved server name and its name guard.

import { normalizeNameForMCP } from '../../services/mcp/normalization.js'

export const COMPUTER_USE_MCP_SERVER_NAME = 'computer-use'

export function isComputerUseMCPServer(name: string): boolean {
  return normalizeNameForMCP(name) === COMPUTER_USE_MCP_SERVER_NAME
}
