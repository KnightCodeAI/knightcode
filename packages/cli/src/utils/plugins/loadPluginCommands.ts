// TODO: plugin-provided slash commands and skills land with the plugin system.
// No plugins are loaded yet, so these report nothing and the caches are empty.
import type { Command } from '../../commands.js'

export async function getPluginCommands(): Promise<Command[]> {
  return []
}

export async function getPluginSkills(): Promise<Command[]> {
  return []
}

export function clearPluginCommandCache(): void {}

export function clearPluginSkillsCache(): void {}
