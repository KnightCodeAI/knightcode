// TODO: the slash-command system (prompt/local/local-jsx commands, argument
// parsing, the command registry) is not implemented yet. The canonical Command
// type lives in types/command.ts; the registry that discovers and runs commands
// lands later. The discovery helpers below report no commands so the SkillTool
// sees nothing invokable until then.

import type { Command } from './types/command.js'

export type { Command } from './types/command.js'
export { getCommandName, isCommandEnabled } from './types/command.js'

export async function getSkillToolCommands(_cwd: string): Promise<Command[]> {
  return []
}

export function getMcpSkillCommands(
  _mcpCommands: readonly Command[],
): readonly Command[] {
  return []
}

export async function getSlashCommandToolSkills(_cwd: string): Promise<Command[]> {
  return []
}
