// Plugin filesystem layout. The full plugin install/data directory resolution
// lands with the plugin subsystem; this provides the per-plugin data dir path
// that hook commands expose via $CLAUDE_PLUGIN_DATA.

import { join } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'

export function getPluginDataDir(pluginId: string): string {
  return join(getClaudeConfigHomeDir(), 'plugins', 'data', pluginId)
}
