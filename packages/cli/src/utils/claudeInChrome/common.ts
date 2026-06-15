// TODO: the browser extension integration is not ported.

import { normalizeNameForMCP } from '../../services/mcp/normalization.js'

export const CLAUDE_IN_CHROME_MCP_SERVER_NAME = 'claude-in-chrome'

export function isClaudeInChromeMCPServer(name: string): boolean {
  return normalizeNameForMCP(name) === CLAUDE_IN_CHROME_MCP_SERVER_NAME
}
