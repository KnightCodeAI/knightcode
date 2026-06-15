// Reconstructed from usage: the upstream type file is not in the source dump.
// Shapes inferred from MCPSettings (construction) and the MCP menus/panels/views
// (reads). The server-info types form a `transport`-discriminated union built
// from each connected client's config; MCPViewState drives panel navigation.

import type {
  ConfigScope,
  MCPServerConnection,
  McpClaudeAIProxyServerConfig,
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../services/mcp/types.js'

interface BaseServerInfo {
  name: string
  client: MCPServerConnection
  scope: ConfigScope
}

export interface StdioServerInfo extends BaseServerInfo {
  transport: 'stdio'
  config: McpStdioServerConfig
}

export interface SSEServerInfo extends BaseServerInfo {
  transport: 'sse'
  isAuthenticated?: boolean
  config: McpSSEServerConfig
}

export interface HTTPServerInfo extends BaseServerInfo {
  transport: 'http'
  isAuthenticated?: boolean
  config: McpHTTPServerConfig
}

export interface ClaudeAIServerInfo extends BaseServerInfo {
  transport: 'claudeai-proxy'
  isAuthenticated: boolean
  config: McpClaudeAIProxyServerConfig
}

export type ServerInfo =
  | StdioServerInfo
  | SSEServerInfo
  | HTTPServerInfo
  | ClaudeAIServerInfo

// An MCP server discovered from an agent's config, grouped by server name with
// the list of agents that reference it.
export interface AgentMcpServerInfo {
  name: string
  sourceAgents: string[]
  transport: 'stdio' | 'sse' | 'http' | 'ws'
  needsAuth: boolean
  isAuthenticated?: boolean
  command?: string
  url?: string
}

// Navigation state for the /mcp management panel.
export type MCPViewState =
  | { type: 'list'; defaultTab?: string }
  | { type: 'server-menu'; server: ServerInfo }
  | { type: 'agent-server-menu'; agentServer: AgentMcpServerInfo }
  | { type: 'server-tools'; server: ServerInfo }
  | { type: 'server-tool-detail'; server: ServerInfo; toolIndex: number }
