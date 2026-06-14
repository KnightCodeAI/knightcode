// TODO: slash-command processing lands with the commands subsystem. Until then
// no command is recognized and the input falls through with no messages.
import type { ProcessUserInputBaseResult } from './processUserInput.js'
import { COMMAND_MESSAGE_TAG, COMMAND_NAME_TAG } from '../../constants/xml.js'

export async function processSlashCommand(
  ..._args: unknown[]
): Promise<ProcessUserInputBaseResult> {
  return { messages: [], shouldQuery: false }
}

export function formatSkillLoadingMetadata(
  skillName: string,
  _progressMessage: string = 'loading',
): string {
  // Use skill name only - UserCommandMessage renders as "Skill(name)"
  return [
    `<${COMMAND_MESSAGE_TAG}>${skillName}</${COMMAND_MESSAGE_TAG}>`,
    `<${COMMAND_NAME_TAG}>${skillName}</${COMMAND_NAME_TAG}>`,
    `<skill-format>true</skill-format>`,
  ].join('\n')
}
