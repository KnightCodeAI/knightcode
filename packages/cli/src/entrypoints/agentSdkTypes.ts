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
export type SyncHookJSONOutput = {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: 'approve' | 'block'
  systemMessage?: string
  reason?: string
  hookSpecificOutput?: unknown
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
