// TODO: only the pieces the conversation types need live here; the full SDK
// type surface (control protocol, settings, tool schemas) lands with the
// SDK entrypoint.

/**
 * Category attached to an assistant message that represents an API failure.
 * Mirrors the SDK's assistant-message error enum.
 */
export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens'

/** SDK status surfaced while long-running maintenance is in flight. */
export type SDKStatus = 'compacting' | null

export type { HookEvent } from '../types/hooks.js'
export { HOOK_EVENTS } from './sdk/coreTypes.js'
export type { PermissionResult } from '../utils/permissions/PermissionResult.js'
export type { PermissionMode } from '../types/permissions.js'
export type { ApiKeySource } from '../utils/auth.js'

// The wire-format messages on the SDK/remote-control stream. Upstream generates
// the exhaustive discriminated union from Zod schemas that are not part of the
// source tree; modeled here structurally (discriminant `type` plus an open
// field set) since the only builder is buildSystemInitMessage and every other
// consumer treats it opaquely.
export type SDKMessage = {
  type: string
  uuid?: string
  message?: { content?: unknown }
  [key: string]: unknown
}

/**
 * JSON a synchronous hook may emit to influence the turn. The full SDK schema
 * carries per-event `hookSpecificOutput` variants; only the common control
 * fields are modeled here until the hook execution layer lands.
 */
// Per-event "hook-specific output" a sync hook may return to influence the loop
// (permission decisions, injected context, mutated tool I/O). Discriminated by
// hookEventName. Mirrors the coreSchemas union 1:1.
export type HookSpecificOutput =
  | {
      hookEventName: 'PreToolUse'
      permissionDecision?: 'allow' | 'deny' | 'ask'
      permissionDecisionReason?: string
      updatedInput?: Record<string, unknown>
      additionalContext?: string
    }
  | { hookEventName: 'UserPromptSubmit'; additionalContext?: string }
  | {
      hookEventName: 'SessionStart'
      additionalContext?: string
      initialUserMessage?: string
      watchPaths?: string[]
    }
  | { hookEventName: 'Setup'; additionalContext?: string }
  | { hookEventName: 'SubagentStart'; additionalContext?: string }
  | {
      hookEventName: 'PostToolUse'
      additionalContext?: string
      updatedMCPToolOutput?: unknown
    }
  | { hookEventName: 'PostToolUseFailure'; additionalContext?: string }
  | { hookEventName: 'PermissionDenied'; retry?: boolean }
  | { hookEventName: 'Notification'; additionalContext?: string }
  | {
      hookEventName: 'PermissionRequest'
      decision:
        | {
            behavior: 'allow'
            updatedInput?: Record<string, unknown>
            updatedPermissions?: PermissionUpdate[]
          }
        | { behavior: 'deny'; message?: string; interrupt?: boolean }
    }
  | {
      hookEventName: 'Elicitation'
      action?: 'accept' | 'decline' | 'cancel'
      content?: Record<string, unknown>
    }
  | {
      hookEventName: 'ElicitationResult'
      action?: 'accept' | 'decline' | 'cancel'
      content?: Record<string, unknown>
    }
  | { hookEventName: 'CwdChanged'; additionalContext?: string }
  | { hookEventName: 'FileChanged'; additionalContext?: string }
  | { hookEventName: 'WorktreeCreate'; worktreePath: string }

export type SyncHookJSONOutput = {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  systemMessage?: string
  reason?: string
  hookSpecificOutput?: HookSpecificOutput
}

// Per-model token + cost rollup used by the stats panels.
export type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
  contextWindow: number
  maxOutputTokens: number
}

// ---------------------------------------------------------------------------
// Hook input payloads. The reference derives these via zod from coreSchemas;
// the schema tree pulls the broader SDK surface, so the structural types are
// declared directly here (the shapes match the schemas 1:1). Each is the
// payload a hook of the named event receives.
// ---------------------------------------------------------------------------

import type { PermissionUpdate } from '../types/permissions.js'
export type { PermissionUpdate }

export type BaseHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  /** Subagent identifier; present only when the hook fires from a subagent. */
  agent_id?: string
  /** Agent type name; present for subagent hooks and --agent main threads. */
  agent_type?: string
}

export type PreToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}

export type PermissionRequestHookInput = BaseHookInput & {
  hook_event_name: 'PermissionRequest'
  tool_name: string
  tool_input: unknown
  permission_suggestions?: PermissionUpdate[]
}

export type PostToolUseHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUse'
  tool_name: string
  tool_input: unknown
  tool_response: unknown
  tool_use_id: string
}

export type PostToolUseFailureHookInput = BaseHookInput & {
  hook_event_name: 'PostToolUseFailure'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  error: string
  is_interrupt?: boolean
}

export type PermissionDeniedHookInput = BaseHookInput & {
  hook_event_name: 'PermissionDenied'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  reason: string
}

export type NotificationHookInput = BaseHookInput & {
  hook_event_name: 'Notification'
  message: string
  title?: string
  notification_type: string
}

export type UserPromptSubmitHookInput = BaseHookInput & {
  hook_event_name: 'UserPromptSubmit'
  prompt: string
}

export type SessionStartHookInput = BaseHookInput & {
  hook_event_name: 'SessionStart'
  source: 'startup' | 'resume' | 'clear' | 'compact'
  agent_type?: string
  model?: string
}

export type SetupHookInput = BaseHookInput & {
  hook_event_name: 'Setup'
  trigger: 'init' | 'maintenance'
}

export type StopHookInput = BaseHookInput & {
  hook_event_name: 'Stop'
  stop_hook_active: boolean
  last_assistant_message?: string
}

export type StopFailureHookInput = BaseHookInput & {
  hook_event_name: 'StopFailure'
  error: SDKAssistantMessageError
  error_details?: string
  last_assistant_message?: string
}

export type SubagentStartHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStart'
  agent_id: string
  agent_type: string
}

export type SubagentStopHookInput = BaseHookInput & {
  hook_event_name: 'SubagentStop'
  stop_hook_active: boolean
  agent_id: string
  agent_transcript_path: string
  agent_type: string
  last_assistant_message?: string
}

export type PreCompactHookInput = BaseHookInput & {
  hook_event_name: 'PreCompact'
  trigger: 'manual' | 'auto'
  custom_instructions: string | null
}

export type PostCompactHookInput = BaseHookInput & {
  hook_event_name: 'PostCompact'
  trigger: 'manual' | 'auto'
  compact_summary: string
}

export type TeammateIdleHookInput = BaseHookInput & {
  hook_event_name: 'TeammateIdle'
  teammate_name: string
  team_name: string
}

export type TaskCreatedHookInput = BaseHookInput & {
  hook_event_name: 'TaskCreated'
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}

export type TaskCompletedHookInput = BaseHookInput & {
  hook_event_name: 'TaskCompleted'
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}

export type ElicitationHookInput = BaseHookInput & {
  hook_event_name: 'Elicitation'
  mcp_server_name: string
  message: string
  mode?: 'form' | 'url'
  url?: string
  elicitation_id?: string
  requested_schema?: Record<string, unknown>
}

export type ElicitationResultHookInput = BaseHookInput & {
  hook_event_name: 'ElicitationResult'
  mcp_server_name: string
  elicitation_id?: string
  mode?: 'form' | 'url'
  action: 'accept' | 'decline' | 'cancel'
  content?: Record<string, unknown>
}

export type ConfigChangeHookInput = BaseHookInput & {
  hook_event_name: 'ConfigChange'
  source:
    | 'user_settings'
    | 'project_settings'
    | 'local_settings'
    | 'policy_settings'
    | 'skills'
  file_path?: string
}

export type InstructionsLoadedHookInput = BaseHookInput & {
  hook_event_name: 'InstructionsLoaded'
  file_path: string
  memory_type: 'User' | 'Project' | 'Local' | 'Managed'
  load_reason:
    | 'session_start'
    | 'nested_traversal'
    | 'path_glob_match'
    | 'include'
    | 'compact'
  globs?: string[]
  trigger_file_path?: string
  parent_file_path?: string
}

export type CwdChangedHookInput = BaseHookInput & {
  hook_event_name: 'CwdChanged'
  old_cwd: string
  new_cwd: string
}

export type FileChangedHookInput = BaseHookInput & {
  hook_event_name: 'FileChanged'
  file_path: string
  event: 'change' | 'add' | 'unlink'
}

export type ExitReason =
  | 'clear'
  | 'resume'
  | 'logout'
  | 'prompt_input_exit'
  | 'other'
  | 'bypass_permissions_disabled'

export type SessionEndHookInput = BaseHookInput & {
  hook_event_name: 'SessionEnd'
  reason: ExitReason
}

export type WorktreeCreateHookInput = BaseHookInput & {
  hook_event_name: 'WorktreeCreate'
  name: string
}

export type WorktreeRemoveHookInput = BaseHookInput & {
  hook_event_name: 'WorktreeRemove'
  worktree_path: string
}

export type HookInput =
  | PreToolUseHookInput
  | PostToolUseHookInput
  | PostToolUseFailureHookInput
  | PermissionDeniedHookInput
  | PermissionRequestHookInput
  | NotificationHookInput
  | UserPromptSubmitHookInput
  | SessionStartHookInput
  | SessionEndHookInput
  | SetupHookInput
  | StopHookInput
  | StopFailureHookInput
  | SubagentStartHookInput
  | SubagentStopHookInput
  | PreCompactHookInput
  | PostCompactHookInput
  | TeammateIdleHookInput
  | TaskCreatedHookInput
  | TaskCompletedHookInput
  | ElicitationHookInput
  | ElicitationResultHookInput
  | ConfigChangeHookInput
  | InstructionsLoadedHookInput
  | CwdChangedHookInput
  | FileChangedHookInput
  | WorktreeCreateHookInput
  | WorktreeRemoveHookInput

export type AsyncHookJSONOutput = {
  async: true
  asyncTimeout?: number
}

export type HookJSONOutput = SyncHookJSONOutput | AsyncHookJSONOutput
