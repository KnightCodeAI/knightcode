// TODO: local workflow tasks land with the workflow subsystem. Only the state
// shape (as a member of the TaskState union) is modelled today.
import type { TaskStateBase } from '../../Task.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  isBackgrounded?: boolean
}
