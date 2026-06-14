// TODO: in-process teammate/swarm permission bridge — owned by the swarm
// feature. Local-only build runs solo, so there is never a leader queue.
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'

export type SetToolUseConfirmQueueFn = (
  updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
) => void

export function getLeaderToolUseConfirmQueue(): SetToolUseConfirmQueueFn | null {
  return null
}
