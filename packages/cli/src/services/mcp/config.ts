// TODO: MCP server configuration (per-scope .mcp.json discovery) lands with the
// MCP phase. No servers are configured yet, so every scope reports none.

export type McpScope = 'enterprise' | 'user' | 'project' | 'local'

export type McpScopeConfigs = {
  servers: Record<string, unknown>
}

export function getMcpConfigsByScope(_scope: McpScope): McpScopeConfigs {
  return { servers: {} }
}

// TODO: per-name MCP config lookup lands with the MCP phase. No servers are
// configured, so every name resolves to none.
export function getMcpConfigByName(
  _name: string,
): import('./types.js').ScopedMcpServerConfig | null {
  return null
}
