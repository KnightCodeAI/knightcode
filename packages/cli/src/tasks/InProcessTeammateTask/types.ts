// TODO: in-process teammate tasks land with the teammate/swarm subsystem. Only
// the state shape (as a member of the TaskState union) is modelled today.
import type { TaskStateBase } from '../../Task.js'
import type { PermissionMode } from '../../types/permissions.js'

export type InProcessTeammateTaskState = TaskStateBase & {
  type: 'in_process_teammate'
  isBackgrounded?: boolean
  // Display fields the spinner reads when a teammate is foregrounded (solo mode
  // never populates these).
  isIdle?: boolean
  progress?: { tokenCount?: number }
  identity: { color?: string; agentName?: string }
  // The teammate's own permission mode, shown in the footer when viewing it.
  permissionMode: PermissionMode
}
