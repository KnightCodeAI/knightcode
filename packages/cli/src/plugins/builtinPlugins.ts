// TODO: built-in plugins (and the skill commands they contribute) land with the
// plugin system. None are enabled yet, so this contributes no skill commands.
import type { Command } from '../commands.js'

export function getBuiltinPluginSkillCommands(): Command[] {
  return []
}
