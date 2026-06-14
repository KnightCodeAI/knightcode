// TODO: hook dispatch is not wired yet — settings resolution, command spawning,
// and the Stop / SubagentStop / TeammateIdle / TaskCompleted executors that
// stream progress and aggregate blocking errors are not implemented. Until then
// these are no-op generators that yield no progress and report no decision, so
// the stop-hook spine binds and runs in the hook-free default (no configured
// hooks → no-op). The AggregatedHookResult type below is the real shape.

import type { HookProgress, PromptRequest, PromptResponse } from '../types/hooks.js'
import type { AgentId } from '../types/ids.js'
import type {
  AttachmentMessage,
  Message,
  ProgressMessage,
} from '../types/message.js'
import type { ToolUseContext } from '../Tool.js'
import type { PermissionResult } from './permissions/PermissionResult.js'
import type { PermissionUpdate } from './permissions/PermissionUpdateSchema.js'
import type { StatusLineCommandInput } from '../types/statusLine.js'
import { getMainThreadAgentType, getSessionId } from '../bootstrap/state.js'

export type HookBlockingError = {
  blockingError: string
  command: string
}

export type PermissionRequestResult =
  | {
      behavior: 'allow'
      updatedInput?: Record<string, unknown>
      updatedPermissions?: PermissionUpdate[]
    }
  | {
      behavior: 'deny'
      message?: string
      interrupt?: boolean
    }

export type AggregatedHookResult = {
  message?: AttachmentMessage | ProgressMessage<HookProgress>
  blockingError?: HookBlockingError
  preventContinuation?: boolean
  stopReason?: string
  hookPermissionDecisionReason?: string
  hookSource?: string
  permissionBehavior?: PermissionResult['behavior']
  additionalContexts?: string[]
  initialUserMessage?: string
  updatedInput?: Record<string, unknown>
  updatedMCPToolOutput?: unknown
  permissionRequestResult?: PermissionRequestResult
  watchPaths?: string[]
  elicitationResponse?: unknown
  elicitationResultResponse?: unknown
  retry?: boolean
}

type HookExecutionTimeoutMs = number

const TOOL_HOOK_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000

type RequestPromptFn = (
  sourceName: string,
  toolInputSummary?: string | null,
) => (request: PromptRequest) => Promise<PromptResponse>

// Per-tool hook executors. These mirror the stop-hook generators above: no-ops
// until the real hook dispatch lands, yielding no results so the orchestration
// runs in the hook-free default (no configured hooks → no-op).
export async function* executePreToolHooks<ToolInput>(
  _toolName: string,
  _toolUseID: string,
  _toolInput: ToolInput,
  _toolUseContext: ToolUseContext,
  _permissionMode?: string,
  _signal?: AbortSignal,
  _timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  _requestPrompt?: RequestPromptFn,
  _toolInputSummary?: string | null,
): AsyncGenerator<AggregatedHookResult> {}

export async function* executePostToolHooks<ToolInput, ToolResponse>(
  _toolName: string,
  _toolUseID: string,
  _toolInput: ToolInput,
  _toolResponse: ToolResponse,
  _toolUseContext: ToolUseContext,
  _permissionMode?: string,
  _signal?: AbortSignal,
  _timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): AsyncGenerator<AggregatedHookResult> {}

export async function* executePostToolUseFailureHooks<ToolInput>(
  _toolName: string,
  _toolUseID: string,
  _toolInput: ToolInput,
  _error: string,
  _toolUseContext: ToolUseContext,
  _isInterrupt?: boolean,
  _permissionMode?: string,
  _signal?: AbortSignal,
  _timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): AsyncGenerator<AggregatedHookResult> {}

export async function* executePermissionDeniedHooks<ToolInput>(
  _toolName: string,
  _toolUseID: string,
  _toolInput: ToolInput,
  _reason: string,
  _toolUseContext: ToolUseContext,
  _permissionMode?: string,
  _signal?: AbortSignal,
  _timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): AsyncGenerator<AggregatedHookResult> {}

export async function* executePermissionRequestHooks<ToolInput>(
  _toolName: string,
  _toolUseID: string,
  _toolInput: ToolInput,
  _toolUseContext: ToolUseContext,
  _permissionMode?: string,
  _permissionSuggestions?: PermissionUpdate[],
  _signal?: AbortSignal,
  _timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  _requestPrompt?: RequestPromptFn,
  _toolInputSummary?: string | null,
): AsyncGenerator<AggregatedHookResult> {}

export function getPreToolHookBlockingMessage(
  hookName: string,
  blockingError: HookBlockingError,
): string {
  return `${hookName} hook error: ${blockingError.blockingError}`
}

export async function* executeStopHooks(
  _permissionMode?: string,
  _signal?: AbortSignal,
  _timeoutMs?: HookExecutionTimeoutMs,
  _stopHookActive?: boolean,
  _subagentId?: AgentId,
  _toolUseContext?: ToolUseContext,
  _messages?: Message[],
  _agentType?: string,
): AsyncGenerator<AggregatedHookResult> {}

export async function* executeTeammateIdleHooks(
  _teammateName: string,
  _teamName: string,
  _permissionMode?: string,
  _signal?: AbortSignal,
  _timeoutMs?: HookExecutionTimeoutMs,
): AsyncGenerator<AggregatedHookResult> {}

export async function* executeSubagentStartHooks(
  _agentId: string,
  _agentType: string,
  _signal?: AbortSignal,
  _timeoutMs?: HookExecutionTimeoutMs,
): AsyncGenerator<AggregatedHookResult> {}

export async function* executeTaskCompletedHooks(
  _taskId: string,
  _taskSubject: string,
  _taskDescription?: string,
  _teammateName?: string,
  _teamName?: string,
  _permissionMode?: string,
  _signal?: AbortSignal,
  _timeoutMs?: HookExecutionTimeoutMs,
  _toolUseContext?: ToolUseContext,
): AsyncGenerator<AggregatedHookResult> {}

// Compaction hooks mirror the stop-hook stubs: no-ops until hook dispatch
// lands. They report no custom instructions and no display message, so
// compaction runs in the hook-free default.
export async function executePreCompactHooks(
  _compactData: {
    trigger: 'manual' | 'auto'
    customInstructions: string | null
  },
  _signal?: AbortSignal,
  _timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): Promise<{
  newCustomInstructions?: string
  userDisplayMessage?: string
}> {
  return {}
}

export async function executePostCompactHooks(
  _compactData: {
    trigger: 'manual' | 'auto'
    compactSummary: string
  },
  _signal?: AbortSignal,
  _timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): Promise<{
  userDisplayMessage?: string
}> {
  return {}
}

export type InstructionsMemoryType = 'User' | 'Project' | 'Local' | 'Managed'

type InstructionsLoadReason =
  | 'session_start'
  | 'nested_traversal'
  | 'path_glob_match'
  | 'include'
  | 'compact'

// Memory-file (CLAUDE.md) load hooks: no-ops until hook dispatch lands. With no
// configured InstructionsLoaded hook, the attachment pipeline loads memory
// files without running any hook.
export function hasInstructionsLoadedHook(): boolean {
  return false
}

export async function executeInstructionsLoadedHooks(
  _filePath: string,
  _memoryType: InstructionsMemoryType,
  _loadReason: InstructionsLoadReason,
  _options?: {
    globs?: string[]
    triggerFilePath?: string
    parentFilePath?: string
    timeoutMs?: number
  },
): Promise<void> {}

// Stop-failure hooks fire when the model never produced a valid response
// (prompt-too-long, image error). No-op until hook dispatch lands; with no
// configured hooks there is nothing to run.
export async function executeStopFailureHooks(
  _lastMessage: Message,
  _toolUseContext: ToolUseContext,
): Promise<void> {}

export function getStopHookMessage(blockingError: HookBlockingError): string {
  return `Stop hook feedback:\n${blockingError.blockingError}`
}

export function getTeammateIdleHookMessage(
  blockingError: HookBlockingError,
): string {
  return `TeammateIdle hook feedback:\n${blockingError.blockingError}`
}

export function getTaskCompletedHookMessage(
  blockingError: HookBlockingError,
): string {
  return `TaskCompleted hook feedback:\n${blockingError.blockingError}`
}

// UserPromptSubmit hooks run before a typed prompt is sent. Inert until hooks
// dispatch lands: the generator yields nothing, so no prompt is ever blocked or
// rewritten and the submit pipeline proceeds with the original input.
export async function* executeUserPromptSubmitHooks(
  _prompt: string,
  _permissionMode: string,
  _toolUseContext: ToolUseContext,
  _requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>,
): AsyncGenerator<AggregatedHookResult> {}

export function getUserPromptSubmitHookBlockingMessage(
  blockingError: HookBlockingError,
): string {
  return `UserPromptSubmit hook feedback:\n${blockingError.blockingError}`
}

// Notification hooks fire when the CLI wants to alert the user (idle, awaiting
// input). Inert until hooks dispatch lands — yields nothing.
export async function* executeNotificationHooks(_notificationData: {
  message: string
  title?: string
}): AsyncGenerator<AggregatedHookResult> {}

// Base fields shared by every hook input payload. The transcript path lands
// with on-disk session persistence; until then it reports empty.
export function createBaseHookInput(
  permissionMode?: string,
  sessionId?: string,
  agentInfo?: { agentId?: string; agentType?: string },
): {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} {
  const resolvedSessionId = sessionId ?? getSessionId()
  const resolvedAgentType = agentInfo?.agentType ?? getMainThreadAgentType()
  return {
    session_id: resolvedSessionId,
    transcript_path: '',
    cwd: process.cwd(),
    permission_mode: permissionMode,
    agent_id: agentInfo?.agentId,
    agent_type: resolvedAgentType,
  }
}

// The statusLine command is a user-configured hook; with hook dispatch inert
// (no configured hooks) it never runs and the statusline falls back to its
// built-in rendering.
export async function executeStatusLineCommand(
  _statusLineInput: StatusLineCommandInput,
  _signal?: AbortSignal,
  _timeoutMs?: number,
  _logResult?: boolean,
): Promise<string | undefined> {
  return undefined
}

// TODO: file-suggestion ("@"-mention) command execution lands with the prompt
// pipeline; inert until then.
export async function executeFileSuggestionCommand(..._args: any[]): Promise<any> { return undefined }

// TODO: session-end hook execution lands with the hooks subsystem; inert.
export async function executeSessionEndHooks(..._args: unknown[]): Promise<void> {}
export function getSessionEndHookTimeoutMs(): number { return 0 }
