// TODO: full session/project storage (transcript dirs, history files) lands
// with the harness. The permission layer only needs the per-project directory
// used to classify project paths; it is rooted at the config dir so the
// classification is stable until the storage layer lands.

import { join } from 'path'
import memoize from 'lodash-es/memoize.js'
import { getOriginalCwd, getSessionId } from '../bootstrap/state.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import { sanitizePath } from './sessionStoragePortable.js'
import type { QueueOperationMessage } from '../types/messageQueueTypes.js'
import type { AgentId } from '../types/ids.js'

export function getProjectsDir(): string {
  return join(getClaudeConfigHomeDir(), 'projects')
}

export const getProjectDir = memoize((projectDir: string): string => {
  return join(getProjectsDir(), sanitizePath(projectDir))
})

export function getTranscriptPath(): string {
  const projectDir = getProjectDir(getOriginalCwd())
  return join(projectDir, `${getSessionId()}.jsonl`)
}

// TODO: session metadata re-appending and the in-memory message cache are part
// of the session storage layer, which is not implemented yet. Compaction calls
// these to keep --resume metadata in window and to drop the stale message
// cache; until the layer lands they are inert.
export function reAppendSessionMetadata(): void {}

export function clearSessionMessagesCache(): void {}

// TODO: queue-operation journaling is part of the session storage layer. The
// message queue records enqueue/remove operations for --resume; until the
// transcript store lands this is inert.
export async function recordQueueOperation(
  _queueOp: QueueOperationMessage,
): Promise<void> {}

// TODO: content-replacement journaling (recording tool-result truncations for
// --resume reconstruction) is part of the session storage layer. Until the
// transcript store lands this is inert.
export async function recordContentReplacement(
  _replacements: readonly unknown[],
  _agentId?: AgentId,
): Promise<void> {}
