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
