// TODO: remote agent tasks land with the remote-session subsystem (the matching
// component is stubbed elsewhere). Only the state shape (as a member of the
// TaskState union) is modelled today.
import type { TaskStateBase } from '../../Task.js'

export type RemoteAgentTaskState = TaskStateBase & {
  type: 'remote_agent'
  isBackgrounded?: boolean
}
