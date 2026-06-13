// TODO: the MCP client/transport and config layer are not implemented yet. The
// pure tool-name predicate and URL sanitizer the tool executor needs live here;
// the config-scope lookup stays inert until server configs are wired up.

import type { Tool } from '../../Tool.js'

export function isToolFromMcpServer(_tool: unknown, _serverName?: string): boolean {
  return false
}

export function isMcpTool(tool: Tool): boolean {
  return tool.name?.startsWith('mcp__') || tool.isMcp === true
}

/**
 * Returns the config scope a tool's MCP server is registered under. The server
 * config registry is not wired up yet, so no scope is resolved.
 */
export function getMcpServerScopeFromToolName(_toolName: string): string | null {
  return null
}

/**
 * Returns a base URL safe to log (query string stripped) for a URL-based MCP
 * server config, or undefined for stdio servers / configs without a URL.
 */
export function getLoggingSafeMcpBaseUrl(config: {
  url?: unknown
}): string | undefined {
  if (!('url' in config) || typeof config.url !== 'string') {
    return undefined
  }

  try {
    const url = new URL(config.url)
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}
