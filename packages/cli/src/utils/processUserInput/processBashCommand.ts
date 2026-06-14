// TODO: bash-mode (`!…`) input processing lands with the commands subsystem.
// Until then bash-mode input produces no messages.
import type { ProcessUserInputBaseResult } from './processUserInput.js'

export async function processBashCommand(
  ..._args: unknown[]
): Promise<ProcessUserInputBaseResult> {
  return { messages: [], shouldQuery: false }
}
