// TODO: plugin loading (marketplaces, plugin cache, enable/disable) is not
// ported. This inert loader reports no plugins so MCP/command discovery that
// folds in plugin sources resolves to empty.

import type { LoadedPlugin, PluginError } from '../../types/plugin.js'

export type PluginLoadResult = {
  enabled: LoadedPlugin[]
  disabled: LoadedPlugin[]
  errors: PluginError[]
}

export async function loadAllPluginsCacheOnly(): Promise<PluginLoadResult> {
  return { enabled: [], disabled: [], errors: [] }
}

export async function loadAllPlugins(): Promise<PluginLoadResult> {
  return { enabled: [], disabled: [], errors: [] }
}
