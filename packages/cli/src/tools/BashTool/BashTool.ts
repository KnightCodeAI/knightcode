// TODO: the Bash tool execution body is not built yet. PowerShell is the
// primary shell tool on this platform; this module carries only the input
// shape the tool-execution layer references for Bash-tool-specific handling.

/** Input accepted by the Bash tool. */
export type BashToolInput = {
  /** The command to execute. */
  command: string
  /** Optional timeout in milliseconds. */
  timeout?: number
  /** Clear, concise description of what this command does. */
  description?: string
  /** Run the command in the background. */
  run_in_background?: boolean
  /** Override sandbox mode and run without sandboxing. */
  dangerouslyDisableSandbox?: boolean
  /** Internal: pre-computed sed edit result from a preview. */
  _simulatedSedEdit?: {
    filePath: string
    newContent: string
  }
}
