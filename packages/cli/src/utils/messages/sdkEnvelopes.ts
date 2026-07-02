// SDK wire-format builders consumed by headless (`-p`) output. These mirror
// upstream's QueryEngine.ts stream shapes field-for-field so parsers written
// against the upstream CLI's `--output-format stream-json`/`--output-format
// json` output keep working unchanged against this fork.

import { randomUUID } from 'crypto'
import { getSessionId } from 'src/bootstrap/state.js'
import { getTotalAPIDuration, getTotalCost } from 'src/cost-tracker.js'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import type { Message } from 'src/types/message.js'

/**
 * Wraps a transcript `assistant`/`user` message in the SDK stream envelope.
 * Every other message kind (progress, attachment, system, ...) is UI/local
 * bookkeeping that upstream never puts on the SDK wire, so this returns
 * `null` for them — callers filter those out of the emitted stream.
 */
export function toSdkEnvelope(msg: Message): SDKMessage | null {
  if (msg.type !== 'assistant' && msg.type !== 'user') {
    return null
  }
  return {
    type: msg.type,
    message: msg.message,
    session_id: getSessionId(),
    parent_tool_use_id: null,
    uuid: msg.uuid,
    timestamp: msg.timestamp,
  }
}

/** Terminal states for the SDK stream's final `result` message. */
export type ResultSubtype = 'success' | 'error_during_execution' | 'error_max_turns'

/**
 * Token usage as reported on the `result` message's `usage` field. Kept
 * narrow (just the four wire fields upstream's result envelope reads off
 * `BetaUsage`) rather than reusing the fork's internal `NonNullableUsage` —
 * that richer type exists to merge streaming message_start/message_delta
 * events for cost accounting (see `updateUsage`/`accumulateUsage` in
 * services/api/knightcode.ts) and carries fields (service_tier,
 * cache_creation, inference_geo, ...) that have no place on a summed,
 * cross-turn total for headless output.
 */
export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export const EMPTY_SDK_USAGE: Usage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

/** Field-wise sum of two usage totals; used to fold each turn's usage into a running total. */
export function accumulateSdkUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + b.cache_creation_input_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  }
}

export type BuildResultMessageArgs = {
  subtype: ResultSubtype
  startTime: number
  numTurns: number
  resultText: string
  usage: Usage
  stopReason: string | null
  errors?: string[]
}

/**
 * Builds the final `result` SDKMessage emitted at the end of a headless
 * (`-p`) turn. Field names/shape mirror upstream's QueryEngine.ts result
 * envelope verbatim.
 *
 * `modelUsage` and `permission_denials` are always emitted empty in Phase 1
 * (per-model usage rollup and permission-denial tracking aren't wired up
 * yet) — the fields still exist on the envelope so parsers written against
 * upstream's `SDKResultMessage` shape don't break when consuming this
 * fork's headless output.
 */
export function buildResultMessage(args: BuildResultMessageArgs): SDKMessage {
  const { subtype, startTime, numTurns, resultText, usage, stopReason, errors } =
    args
  return {
    type: 'result',
    subtype,
    is_error: subtype !== 'success',
    duration_ms: Date.now() - startTime,
    duration_api_ms: getTotalAPIDuration(),
    num_turns: numTurns,
    result: resultText,
    stop_reason: stopReason,
    session_id: getSessionId(),
    total_cost_usd: getTotalCost(),
    usage,
    modelUsage: {},
    permission_denials: [],
    uuid: randomUUID(),
    ...(errors ? { errors } : {}),
  }
}
