// TODO: prompt-cache break detection is analytics-driven; detection is
// inert but the recording surface keeps its shapes.

import type { TextBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { QuerySource } from '../../constants/querySource.js'
import type { AgentId } from '../../types/ids.js'
import type { Message } from '../../types/message.js'

export const CACHE_TTL_1HOUR_MS = 60 * 60 * 1000

export type PromptStateSnapshot = {
  system: TextBlockParam[]
  toolSchemas: BetaToolUnion[]
  querySource: QuerySource
  model: string
  agentId?: AgentId
  fastMode?: boolean
  globalCacheStrategy?: string
  betas?: readonly string[]
  autoModeActive?: boolean
  isUsingOverage?: boolean
  cachedMCEnabled?: boolean
  effortValue?: string | number
  extraBodyParams?: unknown
}

export function recordPromptState(_snapshot: PromptStateSnapshot): void {}

export async function checkResponseForCacheBreak(
  _querySource: QuerySource,
  _cacheReadTokens: number,
  _cacheCreationTokens: number,
  _messages: Message[],
  _agentId?: AgentId,
  _requestId?: string | null,
): Promise<void> {}

/** Reset the cache-read baseline so a legitimate cache deletion isn't flagged
 *  as a break. Inert while detection is inert. */
export function notifyCacheDeletion(
  _querySource: QuerySource,
  _agentId?: AgentId,
): void {}

/** Reset the cache-read baseline after compaction so the post-compact drop
 *  isn't flagged as a break. Inert while detection is inert. */
export function notifyCompaction(
  _querySource: QuerySource,
  _agentId?: AgentId,
): void {}
