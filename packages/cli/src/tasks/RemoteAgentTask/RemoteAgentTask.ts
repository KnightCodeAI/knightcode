// TODO: remote agent tasks land with the remote-session subsystem (the matching
// component is stubbed elsewhere). Only the state shape (as a member of the
// TaskState union) is modelled today.
import type { TaskStateBase } from '../../Task.js'

export type RemoteAgentTaskState = TaskStateBase & {
  type: 'remote_agent'
  isBackgrounded?: boolean
  // TODO: live remote-task fields read by the shared task views; typed ahead
  // of the remote subsystem landing.
  sessionId: string
  title: string
  isRemoteReview?: boolean
  isUltraplan?: boolean
}

// TODO: remote agent task — out of scope, inert stub.
export const RemoteAgentTask = {
  type: 'remote_agent' as const,
  kill(..._args: any[]): Promise<void> { return Promise.resolve() },
}

export function restoreRemoteAgentTasks(..._args: unknown[]): void {}

// TODO: remote-agent spawning is out of scope. These gate the (always-off)
// remote isolation path in the Agent tool; eligibility is never met, so no
// remote task is registered.
export async function checkRemoteAgentEligibility(
  ..._args: unknown[]
): Promise<{ eligible: false; errors: string[] }> {
  return { eligible: false, errors: ['remote agents are not supported'] }
}
export function formatPreconditionError(..._args: unknown[]): string {
  return 'remote agents are not supported'
}
export function getRemoteTaskSessionUrl(..._args: unknown[]): string {
  return ''
}
export function registerRemoteAgentTask(..._args: unknown[]): {
  taskId: string
  sessionId: string
} {
  return { taskId: '', sessionId: '' }
}
