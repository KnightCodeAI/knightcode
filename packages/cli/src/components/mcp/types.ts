// Reconstructed from usage: the upstream type file is not in the source dump.
// AgentMcpServerInfo describes an MCP server discovered from an agent's config,
// grouped by server name with the list of agents that reference it. Shape
// inferred from services/mcp/utils.ts (construction) and components/mcp/* (reads).
export interface AgentMcpServerInfo {
  name: string
  sourceAgents: string[]
  transport: 'stdio' | 'sse' | 'http' | 'ws'
  needsAuth: boolean
  command?: string
  url?: string
}
export interface ClaudeAIServerInfo {}
export interface HTTPServerInfo {}
export interface MCPViewState {}
export interface SSEServerInfo {}
export interface ServerInfo {}
export interface StdioServerInfo {}
