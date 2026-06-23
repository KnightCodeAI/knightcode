// TODO: in-process teammate tasks land with the teammate/swarm subsystem. Only
// the state shape (as a member of the TaskState union) is modelled today.
import type { TaskStateBase } from '../../Task.js'
import type { Message } from '../../types/message.js'
import type { PermissionMode } from '../../types/permissions.js'

export type InProcessTeammateTaskState = TaskStateBase & {
  type: 'in_process_teammate'
  isBackgrounded?: boolean
  // Display fields the spinner reads when a teammate is foregrounded (solo mode
  // never populates these).
  isIdle: boolean
  progress?: { tokenCount?: number; recentActivities?: any[]; lastActivity?: { activityDescription?: string; [key: string]: unknown } }
  identity: { color?: string; agentName: string; teamName: string; agentId: string }
  spinnerVerb?: string
  inProgressToolUseIDs?: Set<string>
  messages?: Message[]
  awaitingPlanApproval?: boolean
  shutdownRequested?: boolean
  startTime?: number
  // Aborts only the teammate's current turn (distinct from abortController,
  // which tears the teammate down). Read by the transcript-view escape handler.
  currentWorkAbortController?: AbortController
  // The teammate's own permission mode, shown in the footer when viewing it.
  permissionMode: PermissionMode
}

// Type guard narrowing a task-state union member to an in-process teammate.
// Solo mode never creates these, so it is always false.
export function isInProcessTeammateTask(
  task: unknown,
): task is InProcessTeammateTaskState {
  return !!task && (task as { type?: string }).type === 'in_process_teammate'
}
