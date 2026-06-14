// TODO: this is the small slice of the bootstrap state the API layer and
// loggers consume; the full startup state (settings, telemetry wiring,
// agent bookkeeping) lands with the harness.

import { randomUUID } from 'crypto'
import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { asSessionId, type SessionId } from '../types/ids.js'
import type { HookEvent } from '../types/hooks.js'
import type { HookCommand } from '../schemas/hooks.js'
import type { AgentColorName } from '../tools/AgentTool/agentColorManager.js'
import type { SettingSource } from '../utils/settings/constants.js'
import type { ModelSetting } from '../utils/model/model.js'

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
  // Plan-mode / auto-mode exit attachments: set when the user leaves the mode
  // so the next turn can inform the model the mode is no longer active.
  hasExitedPlanMode: boolean
  needsPlanModeExitAttachment: boolean
  needsAutoModeExitAttachment: boolean
  // Last date emitted as a date-change attachment (ISO date string).
  lastEmittedDate: string | null
  // Stable name→color assignment for subagents (UI display).
  agentColorMap: Map<string, AgentColorName>
  // Whether the user opted in to showing their prompt text in the transcript.
  userMsgOptIn: boolean
  // Epoch ms of the user's last interaction; feeds the idle notifier.
  lastInteractionTime: number
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
  hasExitedPlanMode: false,
  needsPlanModeExitAttachment: false,
  needsAutoModeExitAttachment: false,
  lastEmittedDate: null,
  agentColorMap: new Map(),
  userMsgOptIn: false,
  lastInteractionTime: 0,
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

export function getAgentColorMap(): Map<string, AgentColorName> {
  return STATE.agentColorMap
}

export function getUserMsgOptIn(): boolean {
  return STATE.userMsgOptIn
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
  add(
    value: number,
    additionalAttributes?: Record<
      string,
      string | number | boolean | undefined
    >,
  ): void
}

// TODO: the LOC counter is provisioned by the statusline/metrics layer. Until
// then nothing is counting, so callers guard on null.
export function getLocCounter(): AttributedCounter | null {
  return null
}

// TODO: the code-edit decision counter is provisioned by the metrics layer
// alongside the other attributed counters. Until then nothing is counting.
export function getCodeEditToolDecisionCounter(): AttributedCounter | null {
  return null
}

// TODO: git-operation counters are provisioned by the metrics layer alongside
// the other attributed counters. Until then nothing is counting.
export function getCommitCounter(): AttributedCounter | null {
  return null
}

export function getPrCounter(): AttributedCounter | null {
  return null
}

// TODO: the OpenTelemetry stats store (histogram/observation sink) is
// provisioned by the metrics layer. Until then there is nothing to record to.
export function getStatsStore():
  | { observe(name: string, value: number): void }
  | null {
  return null
}

// TODO: turn/tool duration aggregation is consumed by the stats display, which
// lands with the metrics layer. The executor records into it; nothing reads it
// yet, so accumulation is a no-op for now.
export function addToToolDuration(_duration: number): void {}

// TODO: classifier-overhead timing is reported by the auto-mode metrics, which
// land with the classifier layer. Nothing reads it yet.
export function addToTurnClassifierDuration(_duration: number): void {}

// TODO: per-model token accounting is populated by the API cost layer. Until
// that wiring lands these report zero so telemetry payloads stay well-formed.
export function getTotalInputTokens(): number {
  return 0
}

export function getTotalOutputTokens(): number {
  return 0
}

// TODO: per-turn token budgeting and cost are populated by the API cost layer.
// Until that wiring lands these report safe defaults so attachment payloads
// stay well-formed.
export function getTurnOutputTokens(): number {
  return 0
}

export function getCurrentTurnTokenBudget(): number | null {
  return null
}

let budgetContinuationCount = 0
export function incrementBudgetContinuationCount(): void {
  budgetContinuationCount++
}

export function getTotalCostUSD(): number {
  return 0
}

export function hasExitedPlanModeInSession(): boolean {
  return STATE.hasExitedPlanMode
}

export function setHasExitedPlanMode(value: boolean): void {
  STATE.hasExitedPlanMode = value
}

export function needsPlanModeExitAttachment(): boolean {
  return STATE.needsPlanModeExitAttachment
}

export function setNeedsPlanModeExitAttachment(value: boolean): void {
  STATE.needsPlanModeExitAttachment = value
}

export function needsAutoModeExitAttachment(): boolean {
  return STATE.needsAutoModeExitAttachment
}

export function setNeedsAutoModeExitAttachment(value: boolean): void {
  STATE.needsAutoModeExitAttachment = value
}

export function getLastEmittedDate(): string | null {
  return STATE.lastEmittedDate
}

export function setLastEmittedDate(date: string | null): void {
  STATE.lastEmittedDate = date
}

export function getTotalCacheReadInputTokens(): number {
  return 0
}

export function getTotalCacheCreationInputTokens(): number {
  return 0
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

// TODO: remote sessions land with the remote/teammate subsystem. This build
// runs locally only, so remote mode is never active.
export function getIsRemoteMode(): boolean {
  return false
}

// TODO: --agent main-thread agent typing lands with the agents phase; until
// then the main thread runs the default agent (no explicit type).
export function getMainThreadAgentType(): string | undefined {
  return undefined
}

// MCP/plugin channels land with the MCP phase. A channel is a plugin- or
// server-scoped MCP connection enabled via --channels; none are loaded yet.
export type ChannelEntry =
  | { kind: 'plugin'; name: string; marketplace: string; dev?: boolean }
  | { kind: 'server'; name: string; dev?: boolean }

export function getAllowedChannels(): ChannelEntry[] {
  return []
}

export function getHasDevChannels(): boolean {
  return false
}

// The app-state model selection is mirrored here so non-React code (e.g. the
// API layer) can read the active model override. Tracked but not yet consulted
// by the model resolver until that seam lands.
let mainLoopModelOverride: ModelSetting | undefined
export function setMainLoopModelOverride(
  model: ModelSetting | undefined,
): void {
  mainLoopModelOverride = model
}
export function getMainLoopModelOverride(): ModelSetting | undefined {
  return mainLoopModelOverride
}

// TODO: direct-connect (remote control server) is out of scope; there is no
// server URL to advertise.
export function getDirectConnectServerUrl(): string | undefined {
  return undefined
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

// TODO: the per-prompt id is a tracing correlation handle; tracing is out of
// scope, so recording it is a no-op until (if ever) a consumer needs it.
export function setPromptId(_id: string | null): void {}

// TODO: plan-mode transition side effects (cache breaking, attachment latches)
// are wired with the plan-mode flow; inert here. Session persistence is always
// on in this build. Interaction-time tracking feeds the idle notifier.
export function handlePlanModeTransition(
  _fromMode: string,
  _toMode: string,
): void {}

export function isSessionPersistenceDisabled(): boolean {
  return false
}

export function getLastInteractionTime(): number {
  return STATE.lastInteractionTime
}

export function updateLastInteractionTime(_immediate?: boolean): void {
  STATE.lastInteractionTime = Date.now()
}

// TODO: skill-invocation tracking + trust/opt-in setters land with their
// subsystems; inert placeholders so the settings/trust UIs compile.
export function clearInvokedSkillsForAgent(_agentId?: unknown): void {}
export function setSessionTrustAccepted(_accepted?: unknown): void {}
export function setUserMsgOptIn(_value?: unknown): void {}
export function getInitialMainLoopModel(): any { return null }

// TODO: per-turn metric counters (hook/tool/classifier durations + counts) and
// the session-switch/cost-restore machinery land with the harness's full
// startup state. Inert placeholders: counters read zero, switches update only
// the active sessionId, so the metrics UI and /resume path compile and the
// solo boot path behaves identically to upstream.
export function getTurnHookDurationMs(): number { return 0 }
export function getTurnHookCount(): number { return 0 }
export function resetTurnHookDuration(): void {}
export function getTurnToolDurationMs(): number { return 0 }
export function getTurnToolCount(): number { return 0 }
export function resetTurnToolDuration(): void {}
export function getTurnClassifierDurationMs(): number { return 0 }
export function getTurnClassifierCount(): number { return 0 }
export function resetTurnClassifierDuration(): void {}
export function getBudgetContinuationCount(): number { return 0 }
export function snapshotOutputTokensForTurn(_budget: number | null): void {}
export function getActiveTimeCounter(): AttributedCounter | null { return null }
export function setMainThreadAgentType(_agentType: string | undefined): void {}
export function setOriginalCwd(_cwd: string): void {}

export function addInvokedSkill(
  _skillName: string,
  _skillPath: string,
  _content: string,
  _agentId: string | null = null,
): void {}
export function clearInvokedSkills(
  _preservedAgentIds?: ReadonlySet<string>,
): void {}

export function switchSession(
  sessionId: SessionId,
  _projectDir: string | null = null,
): void {
  STATE.sessionId = sessionId
}
export function regenerateSessionId(
  _options: { setCurrentAsParent?: boolean } = {},
): SessionId {
  const id = asSessionId(randomUUID())
  STATE.sessionId = id
  return id
}
export const onSessionSwitch = (
  _cb: (id: SessionId) => void,
): (() => void) => () => {}

// Hooks registered programmatically (plugin hooks, internal callbacks) outside
// settings.json. None are registered in this build, so the registry is empty.
export type RegisteredHookMatcher = {
  matcher?: string
  hooks: HookCommand[]
  pluginRoot?: string
  pluginName?: string
  pluginId?: string
}

export function getRegisteredHooks(): Partial<
  Record<HookEvent, RegisteredHookMatcher[]>
> | null {
  return null
}

// Extra working directories the user added via /add-dir, included when loading
// CLAUDE.md files. Held in module state for the session.
let additionalDirectoriesForClaudeMd: string[] = []

export function getAdditionalDirectoriesForClaudeMd(): string[] {
  return additionalDirectoriesForClaudeMd
}

export function setAdditionalDirectoriesForClaudeMd(
  directories: string[],
): void {
  additionalDirectoriesForClaudeMd = directories
}

export function setCostStateForRestore(_state: {
  totalCostUSD: number
  totalAPIDuration: number
  totalAPIDurationWithoutRetries: number
  totalToolDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  lastDuration: number
  modelUsage: unknown
}): void {}
