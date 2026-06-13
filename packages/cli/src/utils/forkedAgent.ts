// TODO: the forked-agent runner (ForkedAgentParams / runForkedAgent /
// createSubagentContext and the subagent spawn machinery) is a separate
// subsystem and lands with the subagent port. This file currently carries only
// the cache-safe params slot that the stop-hook spine writes after each turn,
// so post-turn forks can later share the main loop's prompt cache.

import type { QuerySource } from '../constants/querySource.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { EMPTY_USAGE, type NonNullableUsage } from '../services/api/logging.js'
import type { Message } from '../types/message.js'
import type { ToolUseContext } from '../Tool.js'
import type { REPLHookContext } from './hooks/postSamplingHooks.js'
import type { SystemPrompt } from './systemPromptType.js'

export type CacheSafeParams = {
  /** System prompt - must match parent for cache hits */
  systemPrompt: SystemPrompt
  /** User context - prepended to messages, affects cache */
  userContext: { [k: string]: string }
  /** System context - appended to system prompt, affects cache */
  systemContext: { [k: string]: string }
  /** Tool use context containing tools, model, and other options */
  toolUseContext: ToolUseContext
  /** Parent context messages for prompt cache sharing */
  forkContextMessages: Message[]
}

// Slot written by handleStopHooks after each turn so post-turn forks
// (promptSuggestion, postTurnSummary, /btw) can share the main loop's
// prompt cache without each caller threading params through.
let lastCacheSafeParams: CacheSafeParams | null = null

export function saveCacheSafeParams(params: CacheSafeParams | null): void {
  lastCacheSafeParams = params
}

export function getLastCacheSafeParams(): CacheSafeParams | null {
  return lastCacheSafeParams
}

/**
 * Creates CacheSafeParams from REPLHookContext.
 * Use this helper when forking from a post-sampling hook context.
 *
 * To override specific fields (e.g., toolUseContext with cloned file state),
 * spread the result and override: `{ ...createCacheSafeParams(context), toolUseContext: clonedContext }`
 *
 * @param context - The REPLHookContext from the post-sampling hook
 */
export function createCacheSafeParams(
  context: REPLHookContext,
): CacheSafeParams {
  return {
    systemPrompt: context.systemPrompt,
    userContext: context.userContext,
    systemContext: context.systemContext,
    toolUseContext: context.toolUseContext,
    forkContextMessages: context.messages,
  }
}

export type ForkedAgentParams = {
  /** Messages to start the forked query loop with */
  promptMessages: Message[]
  /** Cache-safe parameters that must match the parent query */
  cacheSafeParams: CacheSafeParams
  /** Permission check function for the forked agent */
  canUseTool: CanUseToolFn
  /** Source identifier for tracking */
  querySource: QuerySource
  /** Label for analytics (e.g., 'session_memory', 'supervisor') */
  forkLabel: string
  /** Optional overrides for the subagent context (e.g., abortController) */
  overrides?: { abortController?: AbortController } & Record<string, unknown>
  /** Optional cap on output tokens. */
  maxOutputTokens?: number
  /** Optional cap on number of turns (API round-trips) */
  maxTurns?: number
  /** Optional callback invoked for each message as it arrives */
  onMessage?: (message: Message) => void
  /** Skip sidechain transcript recording */
  skipTranscript?: boolean
  /** Skip writing new prompt cache entries on the last message */
  skipCacheWrite?: boolean
}

export type ForkedAgentResult = {
  /** All messages yielded during the query loop */
  messages: Message[]
  /** Accumulated usage across all API calls in the loop */
  totalUsage: NonNullableUsage
}

// TODO: the forked-agent runner is not implemented yet. Compaction forks an
// agent to summarize while sharing the parent's prompt cache; until the runner
// lands this resolves to an empty result, so callers fall back to their own
// streaming path.
export async function runForkedAgent(
  _params: ForkedAgentParams,
): Promise<ForkedAgentResult> {
  return { messages: [], totalUsage: { ...EMPTY_USAGE } }
}
