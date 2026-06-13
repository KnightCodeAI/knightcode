// TODO: in-process teammate tasks land with the teammate/swarm subsystem. Only
// the state shape (as a member of the TaskState union) is modelled today.
import type { TaskStateBase } from '../../Task.js'

export type InProcessTeammateTaskState = TaskStateBase & {
  type: 'in_process_teammate'
  isBackgrounded?: boolean
}
