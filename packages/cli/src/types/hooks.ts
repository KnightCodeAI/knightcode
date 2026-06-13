/**
 * Hook-related types consumed across the tool/permission layer.
 *
 * TODO: the full hook dispatch (sync/async response schemas, blocking errors,
 * settings wiring) is not implemented yet. This carries the shapes the
 * Tool surface and interactive prompt path reference today.
 */

/** Lifecycle points where a hook can fire. */
export type HookEvent =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'SubagentStop'
  | 'PreCompact'
  | 'PostCompact'
  | 'SessionStart'
  | 'Notification'
  | 'PermissionRequest'
  | 'TaskCompleted'
  | 'TeammateIdle'

export type HookProgress = {
  type: 'hook_progress'
  hookEvent: HookEvent
  hookName: string
  command: string
  promptText?: string
  statusMessage?: string
}

/** Interactive prompt requested by a tool (answered by the user in the REPL). */
export type PromptRequest = {
  prompt: string
  message: string
  options: { key: string; label: string; description?: string }[]
}

export type PromptResponse = {
  prompt_response: string
  selected: string
}
