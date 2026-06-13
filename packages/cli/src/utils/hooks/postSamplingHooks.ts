// TODO: the post-sampling hook registry (registerPostSamplingHook /
// runPostSamplingHooks) lands with the input-pipeline port. For now this module
// only exposes the REPLHookContext shape that the stop-hook spine and post-turn
// fork helpers thread through — the runtime registry has no callers yet.

import type { QuerySource } from '../../constants/querySource.js'
import type { Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { SystemPrompt } from '../systemPromptType.js'

export type REPLHookContext = {
  messages: Message[] // Full message history including assistant responses
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  querySource?: QuerySource
}

export type PostSamplingHook = (
  context: REPLHookContext,
) => Promise<void> | void

// Post-sampling hooks run after the model response completes. No-op until hook
// dispatch lands; with no registered hooks there is nothing to run.
export async function executePostSamplingHooks(
  _messages: Message[],
  _systemPrompt: SystemPrompt,
  _userContext: { [k: string]: string },
  _systemContext: { [k: string]: string },
  _toolUseContext: ToolUseContext,
  _querySource?: QuerySource,
): Promise<void> {}
