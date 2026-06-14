// TODO: local workflow tasks land with the workflow subsystem. Only the state
// shape (as a member of the TaskState union) is modelled today.
import type { TaskStateBase } from '../../Task.js'

export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  isBackgrounded?: boolean
  // TODO: live workflow fields read by the shared task views; typed ahead of
  // the workflow subsystem landing.
  workflowName?: string
  agentCount: number
  summary?: string
}

// TODO: live workflow task control lands with the workflow subsystem; inert.
export function killWorkflowTask(_taskId: string, _setAppState: any): void {}
export function skipWorkflowAgent(_taskId: string, _agentId: string, _setAppState: any): void {}
export function retryWorkflowAgent(_taskId: string, _agentId: string, _setAppState: any): void {}
