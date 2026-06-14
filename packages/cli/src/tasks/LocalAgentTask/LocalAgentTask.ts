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
  // TODO: the live runtime populates these; the detail/background views read
  // them, so they are typed (optional) ahead of the task runner landing.
  id: string
  notified?: boolean
  toolUseId?: string
  // Per-task abort handle; the foreground/cancel paths read it to stop a task.
  abortController?: AbortController
  prompt: string
  result?: { totalTokens?: number; totalToolUseCount?: number; [key: string]: unknown }
  selectedAgent?: { agentType?: string; [key: string]: unknown }
  startTime: number
  totalPausedMs?: number
  retain?: boolean
  messages?: any[]
  progress?: {
    summary?: string
    tokenCount?: number
    toolUseCount?: number
    recentActivities?: any[]
    lastActivity?: unknown
  }
}

import type { AppState } from '../../state/AppState.js'
import type { SetAppState } from '../../Task.js'

// TODO: pending-message draining lands with the local-agent task runner. With
// no background tasks producing messages, there is nothing queued to drain.
export function drainPendingMessages(
  _taskId: string,
  _getAppState: () => AppState,
  _setAppState: (f: (prev: AppState) => AppState) => void,
): string[] {
  return []
}

// TODO: panel-agent classification lands with the local-agent task runner. No
// background agent tasks exist in solo mode, so nothing is a panel agent.
export function isPanelAgentTask(_task: unknown): _task is LocalAgentTaskState {
  return false
}

// TODO: the live local-agent progress/activity runtime lands with the task
// subsystem. The detail dialogs consume these shapes structurally, so the types
// are permissive and the functions are inert placeholders.
export type ProgressTracker = any
export type ToolActivity = any

export const LocalAgentTask = {
  type: 'local_agent' as const,
  kill(..._args: any[]): Promise<void> { return Promise.resolve() },
}

export function isLocalAgentTask(task: unknown): task is LocalAgentTaskState {
  return !!task && (task as { type?: string }).type === 'local_agent'
}
export function createProgressTracker(..._args: any[]): any { return {} }
export function createActivityDescriptionResolver(..._args: any[]): any { return () => '' }
export function getProgressUpdate(..._args: any[]): any { return undefined }
export function getTokenCountFromTracker(..._args: any[]): number { return 0 }
export function updateAgentProgress(..._args: any[]): void {}
export function updateProgressFromMessage(..._args: any[]): void {}
export function completeAgentTask(..._args: any[]): void {}
export function failAgentTask(..._args: any[]): void {}
export function killAsyncAgent(..._args: any[]): Promise<void> { return Promise.resolve() }
export function enqueueAgentNotification(..._args: any[]): void {}

// Kill every running local-agent task. The kill itself is inert until the task
// runner lands, but the iteration/selection is real so the cancel hook routes
// through one code path.
export function killAllRunningAgentTasks(
  tasks: Record<string, import('../types.js').TaskState>,
  setAppState: SetAppState,
): void {
  for (const [taskId, task] of Object.entries(tasks)) {
    if (task.type === 'local_agent' && task.status === 'running') {
      void killAsyncAgent(taskId, setAppState)
    }
  }
}

// Flag a local-agent task as having had its termination surfaced to the model,
// so the aggregate cancel notification is only emitted once per task.
export function markAgentsNotified(taskId: string, setAppState: SetAppState): void {
  setAppState(prev => {
    const task = prev.tasks[taskId]
    if (
      !task ||
      task.type !== 'local_agent' ||
      (task as LocalAgentTaskState).notified
    ) {
      return prev
    }
    return {
      ...prev,
      tasks: { ...prev.tasks, [taskId]: { ...task, notified: true } },
    }
  })
}
