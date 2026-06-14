// TODO: JetBrains plugin detection is out of scope (IDE integration). The
// statusline only consults this behind a JetBrains-terminal guard that is
// never true here; report the plugin as present so no install notice shows.
import type { IdeType } from './ide.js'

export function isJetBrainsPluginInstalledCachedSync(_ideType: IdeType): boolean {
  return true
}
