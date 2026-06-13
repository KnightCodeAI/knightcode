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
