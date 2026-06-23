// TODO: this is the small slice of the bootstrap state the API layer and
// loggers consume; the full startup state (settings, telemetry wiring,
// agent bookkeeping) lands with the harness.

import { randomUUID } from 'crypto'
import { realpathSync } from 'fs'
import type {
  BetaMessageStreamParams,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ModelUsage } from '../entrypoints/agentSdkTypes.js'
import { asSessionId, type SessionId } from '../types/ids.js'
import { createSignal } from '../utils/signal.js'
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
  // Project dir the active session's transcript lives under. null = derive
  // from originalCwd. Set atomically with sessionId by switchSession so
  // cross-project/worktree resume reads the right transcript dir.
  sessionProjectDir: string | null
  // Per-session plan slug (plan-mode → implementation lineage). Keyed by
  // sessionId; consumed by session-storage when stamping transcript entries.
  planSlugCache: Map<string, string>
  // Correlation id for the current user prompt; stamped onto transcript
  // user messages so a turn's entries can be grouped on resume.
  promptId: string | null
}

// Resolve symlinks in the launch cwd so session-storage paths stay canonical
// and consistent with shell.ts (which sets cwd via realpath). When the launch
// dir contains a symlink component (macOS /tmp, network/CloudStorage mounts),
// an unresolved path would key session transcripts under a different project.
function resolveInitialCwd(): string {
  const rawCwd = process.cwd()
  try {
    return realpathSync(rawCwd).normalize('NFC')
  } catch {
    // File Provider EPERM on CloudStorage mounts (lstat per path component).
    return rawCwd.normalize('NFC')
  }
}
const initialCwd = resolveInitialCwd()

const STATE: State = {
  sessionId: asSessionId(randomUUID()),
  originalCwd: initialCwd,
  projectRoot: initialCwd,
  cwd: initialCwd,
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
  sessionProjectDir: null,
  planSlugCache: new Map(),
  promptId: null,
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
export function addToTurnHookDuration(_duration: number): void {}

// TODO: classifier-overhead timing is reported by the auto-mode metrics, which
// land with the classifier layer. Nothing reads it yet.
export function addToTurnClassifierDuration(_duration: number): void {}

// ── Session cost / usage ledger ──────────────────────────────────────────────
// Accumulated per API response via addToTotalCostState (called from
// cost-tracker.addToTotalSessionCost in services/api). In-memory for the live
// session; cross-session persistence to project config lands with the
// session-storage layer (setCostStateForRestore below seeds it on resume).
const sessionStartTimeMs = Date.now()
let totalCostUSD = 0
let totalLinesAdded = 0
let totalLinesRemoved = 0
// Output-token count snapshotted at the start of the current turn, so
// getTurnOutputTokens() can report just this turn's output.
let outputTokensAtTurnStart = 0
const modelUsageMap: Record<string, ModelUsage> = {}

function makeUsageEntry(): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
  }
}

function sumUsage(field: keyof ModelUsage): number {
  let total = 0
  for (const usage of Object.values(modelUsageMap)) total += usage[field]
  return total
}

// Accumulates one API response's cost + token usage into the session ledger.
export function addToTotalCostState(
  costUSD: number,
  usage: BetaUsage,
  model: string,
): void {
  totalCostUSD += costUSD
  const entry = (modelUsageMap[model] ??= makeUsageEntry())
  entry.inputTokens += usage.input_tokens ?? 0
  entry.outputTokens += usage.output_tokens ?? 0
  entry.cacheReadInputTokens += usage.cache_read_input_tokens ?? 0
  entry.cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0
  entry.webSearchRequests +=
    usage.server_tool_use?.web_search_requests ?? 0
  entry.costUSD += costUSD
}

export function getModelUsage(): Record<string, ModelUsage> {
  return modelUsageMap
}

export function getUsageForModel(model: string): ModelUsage | undefined {
  return modelUsageMap[model]
}

export function getTotalInputTokens(): number {
  return sumUsage('inputTokens')
}

export function getTotalOutputTokens(): number {
  return sumUsage('outputTokens')
}

// Output tokens produced during the current turn only (since the last
// snapshotOutputTokensForTurn call).
export function getTurnOutputTokens(): number {
  return Math.max(0, getTotalOutputTokens() - outputTokensAtTurnStart)
}

export function getCurrentTurnTokenBudget(): number | null {
  return null
}

export function getTotalDuration(): number {
  return Date.now() - sessionStartTimeMs
}

export function addToTotalLinesChanged(
  additions: number,
  removals: number,
): void {
  totalLinesAdded += additions
  totalLinesRemoved += removals
}

export function getTotalLinesAdded(): number {
  return totalLinesAdded
}

export function getTotalLinesRemoved(): number {
  return totalLinesRemoved
}

let budgetContinuationCount = 0
export function incrementBudgetContinuationCount(): void {
  budgetContinuationCount++
}

export function getTotalCostUSD(): number {
  return totalCostUSD
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
  return sumUsage('cacheReadInputTokens')
}

export function getTotalCacheCreationInputTokens(): number {
  return sumUsage('cacheCreationInputTokens')
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

// Records the current prompt's correlation id. Session-storage stamps it onto
// transcript user messages so a turn's entries can be grouped on resume.
export function setPromptId(id: string | null): void {
  STATE.promptId = id
}

// Drives the one-time plan_mode_exit attachment latch from a mode transition,
// so the next turn can tell the model plan mode is no longer active. Toggling
// quickly back into plan mode clears the pending latch to avoid sending both
// plan_mode and plan_mode_exit.
export function handlePlanModeTransition(
  fromMode: string,
  toMode: string,
): void {
  if (toMode === 'plan' && fromMode !== 'plan') {
    STATE.needsPlanModeExitAttachment = false
  }
  if (fromMode === 'plan' && toMode !== 'plan') {
    STATE.needsPlanModeExitAttachment = true
  }
}

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
export function clearInvokedSkillsForAgent(agentId: string): void {
  for (const [key, skill] of STATE.invokedSkills) {
    if (skill.agentId === agentId) {
      STATE.invokedSkills.delete(key)
    }
  }
}
// SDK background progress summaries are an SDK-only feature; off in this build.
export function getSdkAgentProgressSummariesEnabled(): boolean {
  return false
}
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
export function getBudgetContinuationCount(): number { return budgetContinuationCount }
export function snapshotOutputTokensForTurn(_budget: number | null): void {
  // Record the session output-token count at turn start so getTurnOutputTokens()
  // reports only this turn's output.
  outputTokensAtTurnStart = getTotalOutputTokens()
  // Each new turn resets the per-turn budget-continuation nudge counter so
  // getBudgetContinuationCount() reflects only the current turn.
  budgetContinuationCount = 0
}
export function getActiveTimeCounter(): AttributedCounter | null { return null }
export function setMainThreadAgentType(_agentType: string | undefined): void {}
export function setOriginalCwd(cwd: string): void {
  STATE.originalCwd = cwd.normalize('NFC')
}

// Snapshot of the assembled project-memory content for the current turn, so
// the auto-mode classifier can read it without importing knightcodemd.ts (which
// would create a cycle through permissions/filesystem).
let cachedKnightcodeMdContent: string | null = null
export function setCachedKnightcodeMdContent(content: string | null): void {
  cachedKnightcodeMdContent = content
}
export function getCachedKnightcodeMdContent(): string | null {
  return cachedKnightcodeMdContent
}

// Records a skill invocation so its content can be preserved/re-surfaced across
// compaction. Keyed by `${agentId??''}:${skillName}` so the same skill invoked
// on the main thread and in a subagent are tracked independently.
export function addInvokedSkill(
  skillName: string,
  skillPath: string,
  content: string,
  agentId: string | null = null,
): void {
  const key = `${agentId ?? ''}:${skillName}`
  STATE.invokedSkills.set(key, {
    skillName,
    skillPath,
    content,
    invokedAt: Date.now(),
    agentId,
  })
}
// Clears invoked skills, optionally preserving entries owned by the given
// agent ids (used on compaction to keep live subagents' skills).
export function clearInvokedSkills(
  preservedAgentIds?: ReadonlySet<string>,
): void {
  if (!preservedAgentIds || preservedAgentIds.size === 0) {
    STATE.invokedSkills.clear()
    return
  }
  for (const [key, skill] of STATE.invokedSkills) {
    if (skill.agentId === null || !preservedAgentIds.has(skill.agentId)) {
      STATE.invokedSkills.delete(key)
    }
  }
}

// Emitted whenever the active sessionId changes (switchSession /
// regenerateSessionId). Listeners (e.g. the PID-file updater in
// concurrentSessions) keep external state in sync with the live session.
const sessionSwitched = createSignal<[SessionId]>()

export function switchSession(
  sessionId: SessionId,
  projectDir: string | null = null,
): void {
  // Drop the outgoing session's plan slug — it doesn't carry to the new one.
  STATE.planSlugCache.delete(STATE.sessionId)
  STATE.sessionId = sessionId
  STATE.sessionProjectDir = projectDir
  sessionSwitched.emit(sessionId)
}

/** Project dir the active session's transcript lives under (worktree/cross-
 * project resume), or null to derive from originalCwd. */
export function getSessionProjectDir(): string | null {
  return STATE.sessionProjectDir
}

/** Per-session plan slug map, keyed by sessionId. */
export function getPlanSlugCache(): Map<string, string> {
  return STATE.planSlugCache
}

/** Correlation id for the current user prompt (used to group transcript
 * entries on resume). */
export function getPromptId(): string | null {
  return STATE.promptId
}
export function regenerateSessionId(
  _options: { setCurrentAsParent?: boolean } = {},
): SessionId {
  // New session starts in its own project (originalCwd-derived) with no
  // inherited plan slug.
  STATE.planSlugCache.delete(STATE.sessionId)
  const id = asSessionId(randomUUID())
  STATE.sessionId = id
  STATE.sessionProjectDir = null
  sessionSwitched.emit(id)
  return id
}
export const onSessionSwitch = (
  cb: (id: SessionId) => void,
): (() => void) => sessionSwitched.subscribe(cb)

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
// KNIGHTCODE.md files. Held in module state for the session.
let additionalDirectoriesForKnightcodeMd: string[] = []

export function getAdditionalDirectoriesForKnightcodeMd(): string[] {
  return additionalDirectoriesForKnightcodeMd
}

export function setAdditionalDirectoriesForKnightcodeMd(
  directories: string[],
): void {
  additionalDirectoriesForKnightcodeMd = directories
}

export function setCostStateForRestore(state: {
  totalCostUSD: number
  totalAPIDuration?: number
  totalAPIDurationWithoutRetries?: number
  totalToolDuration?: number
  totalLinesAdded: number
  totalLinesRemoved: number
  lastDuration?: number
  modelUsage?: Record<string, ModelUsage> | undefined
}): void {
  // Seed the ledger from a restored session's persisted totals.
  totalCostUSD = state.totalCostUSD
  totalLinesAdded = state.totalLinesAdded
  totalLinesRemoved = state.totalLinesRemoved
  for (const key of Object.keys(modelUsageMap)) delete modelUsageMap[key]
  if (state.modelUsage) {
    for (const [model, usage] of Object.entries(state.modelUsage)) {
      modelUsageMap[model] = { ...makeUsageEntry(), ...usage }
    }
  }
}
