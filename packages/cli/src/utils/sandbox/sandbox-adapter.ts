// TODO: OS-level sandboxing (filesystem/network restriction, runtime config,
// violation tracking) lands with the shell tool's sandbox layer. Until then the
// adapter is inert: sandboxing is reported disabled so the permission layer's
// sandbox-allowlist checks fall through to ordinary working-directory rules.

export type FsWriteRestrictionConfig = {
  allowOnly: string[]
  denyWithinAllow: string[]
}

export type ISandboxManager = {
  isSandboxingEnabled(): boolean
  getFsWriteConfig(): FsWriteRestrictionConfig
}

export const SandboxManager: ISandboxManager = {
  isSandboxingEnabled() {
    return false
  },
  getFsWriteConfig() {
    return { allowOnly: [], denyWithinAllow: [] }
  },
}
