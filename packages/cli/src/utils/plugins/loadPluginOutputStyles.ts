// TODO: plugin-provided output styles land with the plugins phase. No plugins
// are loaded yet, so there are none.
import type { OutputStyleConfig } from '../../constants/outputStyles.js'

export async function loadPluginOutputStyles(): Promise<OutputStyleConfig[]> {
  return []
}

export function clearPluginOutputStyleCache(): void {}
