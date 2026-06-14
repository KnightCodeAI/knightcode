// TODO: in-process teammate/swarm permission bridge — owned by the swarm
// feature. Local-only build runs solo, so there is never a leader queue.
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'

export type SetToolUseConfirmQueueFn = (
  updater: (prev: ToolUseConfirm[]) => ToolUseConfirm[],
) => void

export function getLeaderToolUseConfirmQueue(): SetToolUseConfirmQueueFn | null {
  return null
}

// TODO: swarm leader permission relay lands with the swarm subsystem; inert.
export function registerLeaderToolUseConfirmQueue(..._args: unknown[]): void {}
export function unregisterLeaderToolUseConfirmQueue(..._args: unknown[]): void {}
export function registerLeaderSetToolPermissionContext(..._args: unknown[]): void {}
export function unregisterLeaderSetToolPermissionContext(..._args: unknown[]): void {}
