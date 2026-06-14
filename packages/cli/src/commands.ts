// TODO: the slash-command system (prompt/local/local-jsx commands, argument
// parsing, the command registry) is not implemented yet. The canonical Command
// type lives in types/command.ts; the registry that discovers and runs commands
// lands later. The discovery helpers below report no commands so the SkillTool
// sees nothing invokable until then.

import type { Command } from './types/command.js'
import { getCommandName } from './types/command.js'

export type { Command } from './types/command.js'
export { getCommandName, isCommandEnabled } from './types/command.js'
export type { CommandResultDisplay } from './types/command.js'
export type { LocalCommandResult } from './types/command.js'

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

// Discovery + cache invalidation. The registry that populates commands lands
// later, so discovery reports nothing and there are no memoization caches to
// clear; the signatures are preserved so the skills-change hook compiles.
export async function getCommands(_cwd: string): Promise<Command[]> {
  return []
}

export function clearCommandMemoizationCaches(): void {}

export function clearCommandsCache(): void {}

export type { LocalJSXCommandContext } from './types/command.js'

// Pure lookup/format helpers over a passed command list — self-contained, no
// registry dependency. The registry that *populates* the list lands later.
export function findCommand(
  commandName: string,
  commands: Command[],
): Command | undefined {
  return commands.find(
    _ =>
      _.name === commandName ||
      getCommandName(_) === commandName ||
      _.aliases?.includes(commandName),
  )
}

export function getCommand(commandName: string, commands: Command[]): Command {
  const command = findCommand(commandName, commands)
  if (!command) {
    throw new ReferenceError(
      `Command ${commandName} not found. Available commands: ${commands
        .map(_ => {
          const name = getCommandName(_)
          return _.aliases ? `${name} (aliases: ${_.aliases.join(', ')})` : name
        })
        .join(', ')}`,
    )
  }
  return command
}

export function hasCommand(commandName: string, commands: Command[]): boolean {
  return findCommand(commandName, commands) !== undefined
}

export function formatDescriptionWithSource(cmd: Command): string {
  return cmd.description
}

// TODO: command bridging (executing slash commands from a remote bridge session)
// is part of the remote subsystem and is not wired. Nothing is bridge-safe in a
// local session, so the bridge-execution gate stays closed.
export function isBridgeSafeCommand(_cmd: Command): boolean {
  return false
}

// TODO: the full command registry lands with the slash-command phase; the
// built-in name list and internal-only set are empty until then.
export const builtInCommandNames = (): Set<string> => new Set()
export const INTERNAL_ONLY_COMMANDS: { name: string }[] = []

export type { ResumeEntrypoint } from './types/command.js'

// TODO: remote-safe command gating + prefix-cache invalidation land with the
// command system; inert (no remote mode, nothing cached).
export const REMOTE_SAFE_COMMANDS = new Set<Command>()
export function clearCommandPrefixCaches(): void {}
