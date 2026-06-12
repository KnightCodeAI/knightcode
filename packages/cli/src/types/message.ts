/**
 * Conversation message types. The transcript is a flat list of `Message`s:
 * user/assistant turns plus attachment, progress, and system entries that
 * never reach the API (they are filtered/converted by
 * normalizeMessagesForAPI before a request is built).
 *
 * This file was reconstructed from usage; types consumed only by the UI
 * layers are still minimal and are fleshed out as their consumers land
 * (marked TODO below).
 */

import type { APIError } from '@anthropic-ai/sdk'
import type {
  BetaMessage,
  BetaRawMessageStreamEvent,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'
import type { SDKAssistantMessageError } from '../entrypoints/agentSdkTypes.js'
import type { PermissionMode } from './permissions.js'

/**
 * Provenance of a user message. undefined = human (keyboard input).
 * Non-human origins are wrapped with explanatory text before being sent
 * to the model (see wrapCommandText) and are hidden from the transcript.
 */
export type MessageOrigin =
  | { kind: 'human' }
  | { kind: 'task-notification' }
  | { kind: 'coordinator' }
  | { kind: 'channel'; server: string }

/** Compaction direction: 'from' keeps earlier messages, 'up_to' keeps later. */
export type PartialCompactDirection = 'from' | 'up_to'

/** Metadata recorded on a compact boundary system message. */
export type CompactMetadata = {
  trigger: 'manual' | 'auto'
  preTokens: number
  userContext?: string
  messagesSummarized?: number
}

export type UserMessage = {
  type: 'user'
  message: {
    role: 'user'
    content: string | ContentBlockParam[]
  }
  uuid: UUID
  timestamp: string
  isMeta?: true | false
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  summarizeMetadata?: {
    messagesSummarized: number
    userContext?: string
    direction?: PartialCompactDirection
  }
  /** Matches the producing tool's `Output` type. */
  toolUseResult?: unknown
  /** MCP protocol metadata passed through to SDK consumers (never sent to the model). */
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  imagePasteIds?: number[]
  /** For tool_result messages: uuid of the assistant message with the matching tool_use. */
  sourceToolAssistantUUID?: UUID
  /** Permission mode when the message was sent (for rewind restoration). */
  permissionMode?: PermissionMode
  origin?: MessageOrigin
}

export type AssistantMessage = {
  type: 'assistant'
  message: BetaMessage
  uuid: UUID
  timestamp: string
  /** Request ID from the API response; links retries and analytics chains. */
  requestId?: string
  /** Set when the response was truncated by the output-token limit. */
  apiError?: 'max_output_tokens'
  error?: SDKAssistantMessageError
  errorDetails?: string
  isApiErrorMessage?: boolean
  isMeta?: boolean
  isVirtual?: true
  /** Model that produced this message when it came from the advisor lane. */
  advisorModel?: string
}

export type ProgressMessage<P = unknown> = {
  type: 'progress'
  data: P
  toolUseID: string
  parentToolUseID: string
  uuid: UUID
  timestamp: string
}

// TODO: Attachment variants land with the context/attachment layer; until
// then the payload is opaque here and typed at the producer.
export type AttachmentMessage = {
  type: 'attachment'
  attachment: unknown
  uuid: UUID
  timestamp: string
}

export type SystemMessageLevel = 'info' | 'warning' | 'error' | 'suggestion'

type SystemMessageBase = {
  type: 'system'
  uuid: UUID
  timestamp: string
  isMeta: boolean
}

export type SystemInformationalMessage = SystemMessageBase & {
  subtype: 'informational'
  content: string
  level: SystemMessageLevel
  toolUseID?: string
  preventContinuation?: boolean
}

export type SystemAPIErrorMessage = Omit<SystemMessageBase, 'isMeta'> & {
  subtype: 'api_error'
  level: 'error'
  error: APIError
  cause?: Error
  retryInMs: number
  retryAttempt: number
  maxRetries: number
}

export type SystemLocalCommandMessage = SystemMessageBase & {
  subtype: 'local_command'
  content: string
  level: SystemMessageLevel
}

export type SystemCompactBoundaryMessage = SystemMessageBase & {
  subtype: 'compact_boundary'
  content: string
  level: SystemMessageLevel
  compactMetadata: CompactMetadata
  /** Preserves the logical parent when compaction rewrites history. */
  logicalParentUuid?: UUID
}

export type SystemMicrocompactBoundaryMessage = SystemMessageBase & {
  subtype: 'microcompact_boundary'
  content: string
  level: SystemMessageLevel
  microcompactMetadata: {
    trigger: 'auto'
    preTokens: number
    tokensSaved: number
    compactedToolIds: string[]
    clearedAttachmentUUIDs: string[]
  }
}

export type SystemTurnDurationMessage = SystemMessageBase & {
  subtype: 'turn_duration'
  durationMs: number
  budgetTokens?: number
  budgetLimit?: number
  budgetNudges?: number
  messageCount?: number
}

export type SystemApiMetricsMessage = SystemMessageBase & {
  subtype: 'api_metrics'
  ttftMs: number
  otps: number
  isP50?: boolean
  hookDurationMs?: number
  turnDurationMs?: number
  toolDurationMs?: number
  classifierDurationMs?: number
  toolCount?: number
  hookCount?: number
  classifierCount?: number
  configWriteCount?: number
}

export type SystemAwaySummaryMessage = SystemMessageBase & {
  subtype: 'away_summary'
  content: string
}

export type SystemMemorySavedMessage = SystemMessageBase & {
  subtype: 'memory_saved'
  writtenPaths: string[]
}

export type SystemAgentsKilledMessage = SystemMessageBase & {
  subtype: 'agents_killed'
}

export type SystemBridgeStatusMessage = SystemMessageBase & {
  subtype: 'bridge_status'
  content: string
  url: string
  upgradeNudge?: string
}

export type SystemScheduledTaskFireMessage = SystemMessageBase & {
  subtype: 'scheduled_task_fire'
  content: string
}

export type SystemPermissionRetryMessage = SystemMessageBase & {
  subtype: 'permission_retry'
  content: string
  commands: string[]
  level: SystemMessageLevel
}

/** One hook invocation as surfaced in the stop-hook summary. */
export type StopHookInfo = {
  command?: string
  promptText?: string
}

export type SystemStopHookSummaryMessage = SystemMessageBase & {
  subtype: 'stop_hook_summary'
  hookCount: number
  hookInfos: StopHookInfo[]
  hookErrors: string[]
  preventedContinuation: boolean
  stopReason: string | undefined
  hasOutput: boolean
  level: SystemMessageLevel
  toolUseID?: string
  hookLabel?: string
  totalDurationMs?: number
}

export type SystemFileSnapshotMessage = SystemMessageBase & {
  subtype: 'file_snapshot'
  content: string
  level: SystemMessageLevel
  snapshotFiles: string[]
}

export type SystemThinkingMessage = SystemMessageBase & {
  subtype: 'thinking'
  content: string
}

export type SystemMessage =
  | SystemInformationalMessage
  | SystemAPIErrorMessage
  | SystemLocalCommandMessage
  | SystemCompactBoundaryMessage
  | SystemMicrocompactBoundaryMessage
  | SystemTurnDurationMessage
  | SystemApiMetricsMessage
  | SystemAwaySummaryMessage
  | SystemMemorySavedMessage
  | SystemAgentsKilledMessage
  | SystemBridgeStatusMessage
  | SystemScheduledTaskFireMessage
  | SystemPermissionRetryMessage
  | SystemStopHookSummaryMessage
  | SystemFileSnapshotMessage
  | SystemThinkingMessage

export type Message =
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | ProgressMessage
  | SystemMessage

/**
 * Raw model stream event as yielded by the query layer. ttftMs rides on the
 * message_start event so the UI can surface time-to-first-token.
 */
export type StreamEvent = {
  type: 'stream_event'
  event: BetaRawMessageStreamEvent
  ttftMs?: number
}

/** Emitted when an API request is about to start (spinner goes to 'requesting'). */
export type RequestStartEvent = {
  type: 'stream_request_start'
}

/** Instructs stream consumers to remove a previously-yielded message. */
export type TombstoneMessage = {
  type: 'tombstone'
  message: Message
}

/** Human-readable progress summary emitted after a tool batch completes. */
export type ToolUseSummaryMessage = {
  type: 'tool_use_summary'
  summary: string
  precedingToolUseIds: string[]
  uuid: UUID
  timestamp: string
}

/**
 * Normalized messages: each content block split into its own message (see
 * normalizeMessages). Content is always in array form after normalization.
 */
export type NormalizedUserMessage = Omit<UserMessage, 'message'> & {
  message: {
    role: 'user'
    content: ContentBlockParam[]
  }
}

export type NormalizedAssistantMessage = AssistantMessage

export type NormalizedMessage =
  | NormalizedUserMessage
  | NormalizedAssistantMessage
  | AttachmentMessage
  | ProgressMessage
  | SystemMessage

// ---------------------------------------------------------------------------
// TODO: display-layer groupings — fleshed out when the transcript renderer
// lands. Field sets below cover what the grouping utilities construct today.
// ---------------------------------------------------------------------------

export type GroupedToolUseMessage = {
  type: 'grouped_tool_use'
  toolName: string
  messages: NormalizedMessage[]
  results: NormalizedMessage[]
  displayMessage: NormalizedMessage
  uuid: string
  timestamp: string
  messageId: string | undefined
}

export type CollapsedReadSearchGroup = {
  type: 'collapsed_read_search'
  searchCount: number
  readCount: number
  listCount: number
  replCount: number
  uuid: string
  timestamp: string
}

// TODO: reconstructed as their consumers port.
export type CollapsibleMessage = NormalizedMessage
export type RenderableMessage =
  | NormalizedMessage
  | GroupedToolUseMessage
  | CollapsedReadSearchGroup
export type HookResultMessage = SystemInformationalMessage
