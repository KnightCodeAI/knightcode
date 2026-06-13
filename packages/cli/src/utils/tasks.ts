import { getSessionId } from '../bootstrap/state.js'

// The v2 task framework (TaskCreate/Get/Update/List) is deferred, so v2 is not
// enabled and TodoWrite remains the active session checklist. When the task
// framework lands this gate flips to the real interactive/SDK detection and the
// richer task utilities move here.
export function isTodoV2Enabled(): boolean {
  return false
}

// TODO: the persistent task store (TaskSchema / createTask / getTask and the
// on-disk task list) lands with the task-tools port. Until then the Task shape
// carries only the fields the stop-hook spine reads, getTaskListId resolves to
// the configured override or the session id, and listTasks reports an empty
// list (solo mode has no shared task store).
export type Task = {
  id: string
  subject: string
  description?: string
  status: string
  owner?: string
}

export function getTaskListId(): string {
  return process.env.CLAUDE_CODE_TASK_LIST_ID ?? getSessionId()
}

export async function listTasks(_taskListId: string): Promise<Task[]> {
  return []
}

export type UnassignTasksResult = {
  unassignedTasks: Array<{ id: string; subject: string }>
  notificationMessage: string
}

// TODO: teammate task reassignment lands with the teammate/swarm subsystem.
// Solo mode has no shared task store, so there is nothing to unassign.
export async function unassignTeammateTasks(
  _teamName: string,
  _teammateId: string,
  _teammateName: string,
  _reason: 'terminated' | 'shutdown',
): Promise<UnassignTasksResult> {
  return { unassignedTasks: [], notificationMessage: '' }
}
