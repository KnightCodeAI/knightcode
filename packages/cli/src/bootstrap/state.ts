// TODO: this is the small slice of the bootstrap state the API layer and
// loggers consume; the full startup state (settings, telemetry wiring,
// agent bookkeeping) lands with the harness.

import { randomUUID } from 'crypto'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { asSessionId, type SessionId } from '../types/ids.js'

type SlowOperation = {
  operation: string
  durationMs: number
  timestamp: number
}

type State = {
  sessionId: SessionId
  isInteractive: boolean
  strictToolResultPairing: boolean
  lastAPIRequest: Omit<BetaMessageStreamParams, 'messages'> | null
  lastAPIRequestMessages: BetaMessageStreamParams['messages'] | null
  lastApiCompletionTimestamp: number | null
  lastMainRequestId: string | null
  // Beta header latches: null = not yet evaluated for this conversation.
  afkModeHeaderLatched: boolean | null
  cacheEditingHeaderLatched: boolean | null
  fastModeHeaderLatched: boolean | null
  thinkingClearLatched: boolean | null
  promptCache1hAllowlist: string[] | null
  promptCache1hEligible: boolean | null
  slowOperations: SlowOperation[]
}

const STATE: State = {
  sessionId: asSessionId(randomUUID()),
  isInteractive: false,
  strictToolResultPairing: false,
  lastAPIRequest: null,
  lastAPIRequestMessages: null,
  lastApiCompletionTimestamp: null,
  lastMainRequestId: null,
  afkModeHeaderLatched: null,
  cacheEditingHeaderLatched: null,
  fastModeHeaderLatched: null,
  thinkingClearLatched: null,
  promptCache1hAllowlist: null,
  promptCache1hEligible: null,
  slowOperations: [],
}

const SLOW_OPERATION_TTL_MS = 5 * 60 * 1000
const MAX_SLOW_OPERATIONS = 20

export function getSessionId(): SessionId {
  return STATE.sessionId
}

export function getIsNonInteractiveSession(): boolean {
  return !STATE.isInteractive
}

export function getIsInteractive(): boolean {
  return STATE.isInteractive
}

export function setIsInteractive(value: boolean): void {
  STATE.isInteractive = value
}

export function getStrictToolResultPairing(): boolean {
  return STATE.strictToolResultPairing
}

export function setStrictToolResultPairing(value: boolean): void {
  STATE.strictToolResultPairing = value
}

export function setLastAPIRequest(
  params: Omit<BetaMessageStreamParams, 'messages'> | null,
): void {
  STATE.lastAPIRequest = params
}

export function getLastAPIRequest(): Omit<
  BetaMessageStreamParams,
  'messages'
> | null {
  return STATE.lastAPIRequest
}

export function setLastAPIRequestMessages(
  messages: BetaMessageStreamParams['messages'] | null,
): void {
  STATE.lastAPIRequestMessages = messages
}

export function getLastAPIRequestMessages():
  | BetaMessageStreamParams['messages']
  | null {
  return STATE.lastAPIRequestMessages
}

export function getLastApiCompletionTimestamp(): number | null {
  return STATE.lastApiCompletionTimestamp
}

export function setLastApiCompletionTimestamp(timestamp: number): void {
  STATE.lastApiCompletionTimestamp = timestamp
}

export function setLastMainRequestId(requestId: string): void {
  STATE.lastMainRequestId = requestId
}

export function getLastMainRequestId(): string | null {
  return STATE.lastMainRequestId
}

export function getAfkModeHeaderLatched(): boolean | null {
  return STATE.afkModeHeaderLatched
}

export function setAfkModeHeaderLatched(v: boolean): void {
  STATE.afkModeHeaderLatched = v
}

export function getCacheEditingHeaderLatched(): boolean | null {
  return STATE.cacheEditingHeaderLatched
}

export function setCacheEditingHeaderLatched(v: boolean): void {
  STATE.cacheEditingHeaderLatched = v
}

export function getFastModeHeaderLatched(): boolean | null {
  return STATE.fastModeHeaderLatched
}

export function setFastModeHeaderLatched(v: boolean): void {
  STATE.fastModeHeaderLatched = v
}

export function getThinkingClearLatched(): boolean | null {
  return STATE.thinkingClearLatched
}

export function setThinkingClearLatched(v: boolean): void {
  STATE.thinkingClearLatched = v
}

/**
 * Reset beta header latches to null so a fresh conversation gets fresh
 * header evaluation.
 */
export function resetBetaHeaderLatches(): void {
  STATE.afkModeHeaderLatched = null
  STATE.cacheEditingHeaderLatched = null
  STATE.fastModeHeaderLatched = null
  STATE.thinkingClearLatched = null
}

export function getPromptCache1hAllowlist(): string[] | null {
  return STATE.promptCache1hAllowlist
}

export function setPromptCache1hAllowlist(allowlist: string[] | null): void {
  STATE.promptCache1hAllowlist = allowlist
}

export function getPromptCache1hEligible(): boolean | null {
  return STATE.promptCache1hEligible
}

export function setPromptCache1hEligible(eligible: boolean | null): void {
  STATE.promptCache1hEligible = eligible
}

export function addSlowOperation(operation: string, durationMs: number): void {
  const now = Date.now()
  // Remove stale operations
  STATE.slowOperations = STATE.slowOperations.filter(
    op => now - op.timestamp < SLOW_OPERATION_TTL_MS,
  )
  // Add new operation
  STATE.slowOperations.push({ operation, durationMs, timestamp: now })
  // Keep only the most recent operations
  if (STATE.slowOperations.length > MAX_SLOW_OPERATIONS) {
    STATE.slowOperations = STATE.slowOperations.slice(-MAX_SLOW_OPERATIONS)
  }
}

export function getSlowOperations(): readonly SlowOperation[] {
  return STATE.slowOperations
}
