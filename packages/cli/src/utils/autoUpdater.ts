// TODO: the auto-updater is out of scope; only the result type is consumed by
// the prompt-input notifications surface.
export type InstallStatus =
  | 'success'
  | 'no_permissions'
  | 'install_failed'
  | 'in_progress'

export type AutoUpdaterResult = {
  version: string | null
  status: InstallStatus
  notifications?: string[]
}
