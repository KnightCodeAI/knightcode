// TODO: turn-end memory extraction (the background agent that mines the
// transcript for facts worth saving) isn't implemented yet. It runs behind a
// feature gate that is off in this build, so the stop-hook spine never reaches
// this; it is a no-op until the memory subsystem lands.

import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import type { ToolUseContext } from '../../Tool.js'

type AppendSystemMessageFn = NonNullable<ToolUseContext['appendSystemMessage']>

export async function executeExtractMemories(
  _context: REPLHookContext,
  _appendSystemMessage?: AppendSystemMessageFn,
): Promise<void> {}

export async function drainPendingExtraction(): Promise<void> {}

export function initExtractMemories(): void {}
