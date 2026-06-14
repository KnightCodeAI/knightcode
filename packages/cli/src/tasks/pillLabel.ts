// TODO: the background-task pill label lands with the task indicator. Returns a
// neutral label until then.
import type { BackgroundTaskState } from './types.js'

export function getPillLabel(tasks: BackgroundTaskState[]): string {
  return tasks.length === 1 ? '1 task' : `${tasks.length} tasks`
}

// TODO: background-task CTA pill logic lands with the task UI; inert for now.
export function pillNeedsCta(_tasks: unknown[]): boolean { return false }
