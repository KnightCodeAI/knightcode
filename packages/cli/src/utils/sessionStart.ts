// TODO: SessionStart hook dispatch is not implemented yet. After compaction
// (and at startup/resume/clear) these hooks restore CLAUDE.md and other context
// as hook-result messages; with no hooks wired up there is nothing to run.

import type { HookResultMessage } from '../types/message.js'

type SessionStartHooksOptions = {
  sessionId?: string
  agentType?: string
  model?: string
  forceSyncExecution?: boolean
}

export async function processSessionStartHooks(
  _source: 'startup' | 'resume' | 'clear' | 'compact',
  _options: SessionStartHooksOptions = {},
): Promise<HookResultMessage[]> {
  return []
}
