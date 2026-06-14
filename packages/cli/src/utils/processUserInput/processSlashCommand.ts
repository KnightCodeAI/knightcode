// TODO: slash-command processing lands with the commands subsystem. Until then
// no command is recognized and the input falls through with no messages.
import type { ProcessUserInputBaseResult } from './processUserInput.js'

export async function processSlashCommand(
  ..._args: unknown[]
): Promise<ProcessUserInputBaseResult> {
  return { messages: [], shouldQuery: false }
}
