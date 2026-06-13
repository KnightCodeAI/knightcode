// TODO: the real hook dispatch — settings resolution, command spawning, and the
// Stop / SubagentStop / TeammateIdle / TaskCompleted executors that stream
// progress and aggregate blocking errors — lands with the query keystone port.
// This whole file is replaced verbatim then. Until then these are no-op
// generators that yield no progress and report no decision, so the stop-hook
// spine binds and runs in the hook-free default (no configured hooks → no-op).

import type { AgentId } from '../types/ids.js'
import type { Message } from '../types/message.js'
import type { ToolUseContext } from '../Tool.js'

export type HookBlockingError = {
  blockingError: string
  command: string
}

export type AggregatedHookResult = {
  message?: Message
  blockingError?: HookBlockingError
  preventContinuation?: boolean
  stopReason?: string
}

type HookExecutionTimeoutMs = number

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
