// TODO: the autoDream background task lands with the dream subsystem. Only the
// state shape (as a member of the TaskState union) is modelled today.
import type { TaskStateBase } from '../../Task.js'

export type DreamTaskState = TaskStateBase & {
  type: 'dream'
  isBackgrounded?: boolean
  // TODO: live dream fields read by the shared task views; typed ahead of the
  // subsystem landing.
  phase?: any
  sessionsReviewing: number
  filesTouched: string[]
}

// TODO: auto-"dream" task — out of scope, inert stub.
export const DreamTask = {
  type: 'dream' as const,
  kill(..._args: any[]): Promise<void> { return Promise.resolve() },
}
