// TODO: plugin-provided MCP servers are not ported (plugin loading is inert).
// This reports no MCP servers for any plugin.

import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'

export async function getPluginMcpServers(
  _plugin: LoadedPlugin,
  _errors: PluginError[] = [],
): Promise<Record<string, ScopedMcpServerConfig> | undefined> {
  return undefined
}
