// TODO: the autoDream background task lands with the dream subsystem. Only the
// state shape (as a member of the TaskState union) is modelled today.
import type { TaskStateBase } from '../../Task.js'

export type DreamTaskState = TaskStateBase & {
  type: 'dream'
  isBackgrounded?: boolean
}
