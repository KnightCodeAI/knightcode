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
  isSandboxEnabledInSettings(): boolean
  areUnsandboxedCommandsAllowed(): boolean
  isAutoAllowBashIfSandboxedEnabled(): boolean
  getFsWriteConfig(): FsWriteRestrictionConfig
  wrapWithSandbox(
    command: string,
    binShell?: string,
    customConfig?: unknown,
    abortSignal?: AbortSignal,
  ): Promise<string>
  cleanupAfterCommand(): void
}

export const SandboxManager: ISandboxManager = {
  isSandboxingEnabled() {
    return false
  },
  isSandboxEnabledInSettings() {
    return false
  },
  areUnsandboxedCommandsAllowed() {
    return true
  },
  isAutoAllowBashIfSandboxedEnabled() {
    return false
  },
  getFsWriteConfig() {
    return { allowOnly: [], denyWithinAllow: [] }
  },
  // Inert: returns the command unchanged. Real sandbox wrapping lands with the
  // OS-level sandbox layer; until then commands run unsandboxed.
  async wrapWithSandbox(command: string) {
    return command
  },
  cleanupAfterCommand() {},
}
