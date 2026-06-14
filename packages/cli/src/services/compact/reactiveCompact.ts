// TODO: reactive compaction (recovering from a prompt-too-long / media-size API
// error by compacting and retrying) isn't implemented yet. It runs behind a
// feature gate that is off in this build, so the query loop never reaches these;
// they report "not withheld" / "no recovery" so the loop surfaces the error
// normally instead of retrying.

import type { Message } from '../../types/message.js'
import type { CompactionResult } from './compact.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import type { QuerySource } from '../../constants/querySource.js'

export function isReactiveCompactEnabled(): boolean {
  return false
}

export function isWithheldPromptTooLong(_message: unknown): boolean {
  return false
}

export function isWithheldMediaSizeError(_message: unknown): boolean {
  return false
}

export async function tryReactiveCompact(_args: {
  hasAttempted: boolean
  querySource: QuerySource
  aborted: boolean
  messages: Message[]
  cacheSafeParams: CacheSafeParams
}): Promise<CompactionResult | null> {
  return null
}

// Reactive-only mode routes /compact through the reactive path instead of the
// classic summarizer. Off in this build (the feature gate above is false), so
// /compact always uses the classic path.
export function isReactiveOnlyMode(): boolean {
  return false
}

export type ReactiveCompactOutcome =
  | { ok: true; result: CompactionResult }
  | {
      ok: false
      reason: 'too_few_groups' | 'aborted' | 'exhausted' | 'error' | 'media_unstrippable'
    }

export async function reactiveCompactOnPromptTooLong(
  _messages: Message[],
  _cacheSafeParams: CacheSafeParams,
  _options: { customInstructions?: string | null; trigger: 'manual' | 'auto' },
): Promise<ReactiveCompactOutcome> {
  return { ok: false, reason: 'error' }
}
