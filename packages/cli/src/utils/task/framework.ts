// TODO: the background task framework (tracking spawned agent tasks, producing
// per-turn status deltas, and evicting finished tasks from the registry) is not
// implemented yet. The attachment pipeline re-announces in-flight tasks each
// turn; until the task runner lands there are no tasks to report.
import type { AppState } from '../../state/AppState.js'
import type { TaskStatus, TaskType } from '../../Task.js'

export type TaskAttachment = {
  type: 'task_status'
  taskId: string
  toolUseId?: string
  taskType: TaskType
  status: TaskStatus
  description: string
  deltaSummary: string | null
}

type SetAppState = (updater: (prev: AppState) => AppState) => void

export async function generateTaskAttachments(_state: AppState): Promise<{
  attachments: TaskAttachment[]
  updatedTaskOffsets: Record<string, number>
  evictedTaskIds: string[]
}> {
  return { attachments: [], updatedTaskOffsets: {}, evictedTaskIds: [] }
}

export function applyTaskOffsetsAndEvictions(
  _setAppState: SetAppState,
  _updatedTaskOffsets: Record<string, number>,
  _evictedTaskIds: string[],
): void {}

export function registerTask(..._args: any[]): any { return undefined }
export function updateTaskState<T = any>(
  _taskId: any,
  _setAppState: any,
  _updater: (task: T) => T,
): void {}
