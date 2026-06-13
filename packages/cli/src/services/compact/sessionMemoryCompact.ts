// TODO: session memory compaction is not implemented yet. Session memory is a
// separate subsystem (extraction, thresholds, prompt truncation); until it
// lands, compaction always falls through to the regular summarization path.

import type { AgentId } from '../../types/ids.js'
import type { CompactionResult } from './compact.js'

/**
 * Try to use session memory for compaction instead of traditional compaction.
 * Returns null when session memory compaction cannot be used — which, until the
 * subsystem lands, is always.
 */
export async function trySessionMemoryCompaction(
  _messages: unknown[],
  _agentId?: AgentId,
  _autoCompactThreshold?: number,
): Promise<CompactionResult | null> {
  return null
}
