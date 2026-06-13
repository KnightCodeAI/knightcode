import type { ToolPermissionContext } from '../../Tool.js'

// OS-level sandboxing is inert until the sandbox layer lands (see
// utils/sandbox/sandbox-adapter.ts). Commands run unsandboxed, so this always
// reports false. The signature matches the real helper so callers — and the
// real implementation that replaces it — need no changes.
export function shouldUseSandbox(_opts: {
  command: string
  dangerouslyDisableSandbox?: boolean
  toolPermissionContext?: ToolPermissionContext
}): boolean {
  return false
}
