// TODO: MCP server connection management (spawning/connecting to MCP servers,
// listing their tools, and proxying tool calls) is not implemented yet. The
// error types below are the only pieces the tool executor references — it
// catches them to map MCP failures onto tool results — so they are defined
// here standalone until the connection layer lands.

import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../utils/errors.js'
import type { Tool } from '../../Tool.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
} from './types.js'

// TODO: MCP server connection lands with the MCP transport. With no MCP servers
// configured, agent frontmatter never references one, so these resolve a server
// as failed and surface no tools rather than opening a connection.
export async function connectToServer(
  name: string,
  config: ScopedMcpServerConfig,
): Promise<MCPServerConnection> {
  return { name, config, type: 'failed' }
}

export async function fetchToolsForClient(
  _client: MCPServerConnection,
): Promise<Tool[]> {
  return []
}

export class McpAuthError extends Error {
  serverName: string
  constructor(serverName: string, message: string) {
    super(message)
    this.name = 'McpAuthError'
    this.serverName = serverName
  }
}

/**
 * Thrown when an MCP tool returns `isError: true`. Carries the result's `_meta`
 * so SDK consumers can still receive it — per the MCP spec, `_meta` is on the
 * base Result type and is valid on error results.
 */
export class McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS extends TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  constructor(
    message: string,
    telemetryMessage: string,
    readonly mcpMeta?: { _meta?: Record<string, unknown> },
  ) {
    super(message, telemetryMessage)
    this.name = 'McpToolCallError'
  }
}
