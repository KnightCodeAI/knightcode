// TODO: the background local-agent task runner (progress tracking, eviction,
// disk bootstrap) is not implemented yet. This carries the task-state shape the
// compaction and attachment layers read; the runtime that produces and mutates
// these records lands with the task subsystem.

export type LocalAgentTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'

export type LocalAgentTaskState = {
  type: 'local_agent'
  agentId: string
  status: LocalAgentTaskStatus
  description: string
  retrieved: boolean
  error?: string
  progress?: { summary?: string }
}

import type { AppState } from '../../state/AppState.js'

// TODO: pending-message draining lands with the local-agent task runner. With
// no background tasks producing messages, there is nothing queued to drain.
export function drainPendingMessages(
  _taskId: string,
  _getAppState: () => AppState,
  _setAppState: (f: (prev: AppState) => AppState) => void,
): string[] {
  return []
}
