// TODO: context-collapse is not implemented yet. It is a separate context
// management strategy gated behind a feature flag; compaction and the query
// loop only consult these inside dead-code-eliminated guards, so inert values
// keep the autocompact path on its default behavior.

import type { Message } from '../../types/message.js'
import type { ToolUseContext } from '../../Tool.js'
import type { QuerySource } from '../../constants/querySource.js'

export function isContextCollapseEnabled(): boolean {
  return false
}

export function resetContextCollapse(): void {}

export function isWithheldPromptTooLong(
  _message: unknown,
  _isPromptTooLongMessage?: unknown,
  _querySource?: QuerySource,
): boolean {
  return false
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
  _toolUseContext: ToolUseContext,
  _querySource: QuerySource,
): Promise<{ messages: Message[] }> {
  return { messages }
}

export function recoverFromOverflow(
  messages: Message[],
  _querySource: QuerySource,
): { committed: number; messages: Message[] } {
  return { committed: 0, messages }
}
