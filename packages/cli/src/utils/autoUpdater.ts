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

// TODO: npm/GCS dist-tag lookup for the update checker (not ported). No update
// channel is queried, so the tag sets are empty.
export type NpmDistTags = { latest?: any; [key: string]: any }
export async function getNpmDistTags(): Promise<NpmDistTags> {
  return {}
}
export async function getGcsDistTags(): Promise<NpmDistTags> {
  return {}
}
