// TODO: remote "teleport" (launching the session in a remote CCR environment)
// is an out-of-scope remote subsystem. The Agent tool reaches this only on the
// always-off `isolation: "remote"` path; with no remote backend, teleport never
// produces a session and the caller surfaces a "not supported" error.
import type { PermissionMode } from '../types/permissions.js'

export async function teleportToRemote(_options: {
  initialMessage: string | null
  branchName?: string
  title?: string
  description?: string
  model?: string
  permissionMode?: PermissionMode
  ultraplan?: boolean
  signal: AbortSignal
  useDefaultEnvironment?: boolean
  environmentId?: string
  environmentVariables?: Record<string, string>
  onBundleFail?: (msg: string) => void
  [key: string]: unknown
}): Promise<{ id: string; title?: string; [key: string]: unknown } | null> {
  return null
}
