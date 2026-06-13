// TODO: this is the small slice of the bootstrap state the API layer and
// loggers consume; the full startup state (settings, telemetry wiring,
// agent bookkeeping) lands with the harness.

import { randomUUID } from 'crypto'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { asSessionId, type SessionId } from '../types/ids.js'
import type { SettingSource } from '../utils/settings/constants.js'

type SlowOperation = {
  operation: string
  durationMs: number
  timestamp: number
}

export type InvokedSkillInfo = {
  skillName: string
  skillPath: string
  content: string
  invokedAt: number
  agentId: string | null
}

type State = {
  sessionId: SessionId
  originalCwd: string
  projectRoot: string
  cwd: string
  allowedSettingSources: SettingSource[]
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
  // SDK-provided betas (e.g., context-1m-2025-08-07)
  sdkBetas: string[] | undefined
  // Set after a compaction; consumed once by the next API success event.
  pendingPostCompaction: boolean
  // Skills invoked this session, keyed by skill name; agentId scopes them to
  // the main thread (null) or a specific subagent.
  invokedSkills: Map<string, InvokedSkillInfo>
}

const STATE: State = {
  sessionId: asSessionId(randomUUID()),
  originalCwd: process.cwd().normalize('NFC'),
  projectRoot: process.cwd().normalize('NFC'),
  cwd: process.cwd().normalize('NFC'),
  allowedSettingSources: [
    'userSettings',
    'projectSettings',
    'localSettings',
    'flagSettings',
    'policySettings',
  ],
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
  sdkBetas: undefined,
  pendingPostCompaction: false,
  invokedSkills: new Map(),
}

const SLOW_OPERATION_TTL_MS = 5 * 60 * 1000
const MAX_SLOW_OPERATIONS = 20

export function getSessionId(): SessionId {
  return STATE.sessionId
}

export function getOriginalCwd(): string {
  return STATE.originalCwd
}

export function getProjectRoot(): string {
  return STATE.projectRoot
}

/**
 * Only for --worktree startup flag. Mid-session worktree entry must NOT call
 * this — skills/history should stay anchored to where the session started.
 */
export function setProjectRoot(cwd: string): void {
  STATE.projectRoot = cwd.normalize('NFC')
}

// Assistant-mode ("Kairos") changes how long-running commands auto-background.
// That mode is not wired yet; report inactive so the shell tools take the
// ordinary foreground path. Gated behind feature('KAIROS') at the call site.
export function getKairosActive(): boolean {
  return false
}

export function getCwdState(): string {
  return STATE.cwd
}

export function setCwdState(cwd: string): void {
  STATE.cwd = cwd.normalize('NFC')
}

export function getAllowedSettingSources(): SettingSource[] {
  return STATE.allowedSettingSources
}

/** Attributed lines-of-code counter, when one is installed for the session. */
type AttributedCounter = {
  add(value: number, attributes: { type: 'added' | 'removed' }): void
}

// TODO: the LOC counter is provisioned by the statusline/metrics layer. Until
// then nothing is counting, so callers guard on null.
export function getLocCounter(): AttributedCounter | null {
  return null
}

// TODO: scroll-draining coordination is owned by the REPL renderer. With no
// interactive scroll buffer active here, there is nothing to wait for.
export async function waitForScrollIdle(): Promise<void> {}

export function setAllowedSettingSources(sources: SettingSource[]): void {
  STATE.allowedSettingSources = sources
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

let hasUnknownModelCost = false

export function setHasUnknownModelCost(value: boolean = true): void {
  hasUnknownModelCost = value
}

export function getHasUnknownModelCost(): boolean {
  return hasUnknownModelCost
}

export function getSdkBetas(): string[] | undefined {
  return STATE.sdkBetas
}

/** Whether an SDK REPL bridge is attached to this session. */
export function isReplBridgeActive(): boolean {
  return false
}

export function getSlowOperations(): readonly SlowOperation[] {
  return STATE.slowOperations
}

/** Mark that a compaction just occurred. The next API success event will
 *  include isPostCompaction=true, then the flag auto-resets. */
export function markPostCompaction(): void {
  STATE.pendingPostCompaction = true
}

/** Consume the post-compaction flag. Returns true once after compaction,
 *  then returns false until the next compaction. */
export function consumePostCompaction(): boolean {
  const was = STATE.pendingPostCompaction
  STATE.pendingPostCompaction = false
  return was
}

// TODO: the skill-invocation setters (addInvokedSkill and the per-turn /
// subagent cleanup helpers) land with the Skill tool port. The session starts
// with no invoked skills, so this getter reports an empty map until then.
export function getInvokedSkillsForAgent(
  agentId: string | undefined | null,
): Map<string, InvokedSkillInfo> {
  const normalizedId = agentId ?? null
  const filtered = new Map<string, InvokedSkillInfo>()
  for (const [key, skill] of STATE.invokedSkills) {
    if (skill.agentId === normalizedId) {
      filtered.set(key, skill)
    }
  }
  return filtered
}
