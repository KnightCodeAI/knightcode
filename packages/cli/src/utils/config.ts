import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { join, resolve } from 'path'
import { getOriginalCwd } from '../bootstrap/state.js'
import { getKnightcodeConfigHomeDir } from './envUtils.js'
import { getManagedFilePath } from './settings/managedPath.js'
import type { MemoryType } from './memory/types.js'
import type { ThemeSetting } from './theme.js'
import type { ImageDimensions } from './imageResizer.js'
import type { StoredCompanion } from '../buddy/types.js'
import type { McpServerConfig } from '../services/mcp/types.js'

// A single pasted/dropped item awaiting submission (text or image).
export type PastedContent = {
  id: number
  type: 'text' | 'image'
  content: string
  mediaType?: string
  filename?: string
  dimensions?: ImageDimensions
  sourcePath?: string
}

// One entry in the prompt input history (what the arrow keys cycle through).
export interface HistoryEntry {
  display: string
  pastedContents: Record<number, PastedContent>
}

// Global (per-user) configuration. Grows as features land; fields with
// defaults are filled in when an older config file omits them.
export type GlobalConfig = {
  theme: ThemeSetting
  /** User-scoped MCP servers (global `.knightcode.json`). */
  mcpServers?: Record<string, McpServerConfig>
  // TODO: these settings are surfaced by the settings UI ahead of the
  // subsystems that consume them (notifications, IDE, teammates, checkpointing,
  // speculation). Typed here so the config panel compiles.
  additionalModelOptionsCache?: any[]
  agentPushNotifEnabled?: boolean
  autoConnectIde?: boolean
  autoPermissionsNotificationCount?: number
  btwUseCount: number // Number of times user has used /btw
  hasAcknowledgedCostThreshold?: boolean
  idleReturnDismissed?: boolean
  messageIdleNotifThresholdMs: number
  promptQueueUseCount?: number
  autoUpdates?: boolean
  cachedExtraUsageDisabledReason?: string | null
  knightcodeInChromeDefaultEnabled?: boolean
  copyFullResponse?: boolean
  customApiKeyResponses?: { approved?: string[]; rejected?: string[] }
  diffTool?: string
  fileCheckpointingEnabled?: boolean
  inputNeededNotifEnabled?: boolean
  remoteControlAtStartup?: boolean
  respectGitignore?: boolean
  showStatusInTerminalTab?: boolean
  speculationEnabled?: boolean
  taskCompleteNotifEnabled?: boolean
  teammateDefaultModel?: string | null
  teammateMode?: 'auto' | 'tmux' | 'in-process'
  openRouterFavorites?: string[]
  /** Random per-install identifier (created on first use). */
  userID?: string
  /** Server-pushed client data; absent until remote config lands. */
  clientDataCache?: Record<string, unknown> | null
  /** Whether the conversation is auto-compacted as it nears the context
   *  window. On by default; users can opt out in settings. */
  autoCompactEnabled: boolean
  /** Whether to draw the terminal's native progress bar during long tool runs. */
  terminalProgressBarEnabled?: boolean
  /** OAuth account info; absent in BYOK builds (no hosted account). */
  oauthAccount?: {
    accountUuid?: string
    displayName?: string
    organizationName?: string
    [key: string]: unknown
  }
  /** Stored desktop-companion state (soul only; bones regenerate from userID). */
  companion?: StoredCompanion
  /** Whether the desktop companion's intro/notifications are muted. */
  companionMuted?: boolean
  /** Terminal-setup bookkeeping (the /terminal-setup command). */
  shiftEnterKeyBindingInstalled?: boolean
  optionAsMetaKeyInstalled?: boolean
  hasUsedBackslashReturn?: boolean
  appleTerminalSetupInProgress?: boolean
  appleTerminalBackupPath?: string
  /** Whether the per-turn duration is shown in the transcript. */
  showTurnDuration?: boolean
  /** Text-editing keymap for the prompt input. */
  editorMode?: EditorMode
  /** Whether the user has seen the tasks hint. */
  hasSeenTasksHint?: boolean
  /** Whether the user has used the stash feature (Ctrl+S). */
  hasUsedStash?: boolean
  /** How many times the queued-command up-arrow hint has been shown. */
  queuedCommandUpHintCount?: number
  /** How many sessions the "hold to speak" footer hint has been shown. */
  voiceFooterHintSeenCount?: number
  /** Auto-copy to clipboard on mouse-up (undefined → true). */
  copyOnSelect?: boolean
  /** Show PR review status in the footer (default: true). */
  prStatusFooterEnabled?: boolean
  /** Per-skill usage stats used to rank command suggestions. */
  skillUsage?: Record<string, { usageCount: number; lastUsedAt: number }>
  /** ISO timestamp of the user's first token (onboarding bookkeeping). */
  knightcodeFirstTokenDate?: string
  /** Preferred OS notification channel ('auto', 'terminal', etc.). */
  preferredNotifChannel: string
  /** Enable model-generated explanations for permission requests (default true). */
  permissionExplainerEnabled?: boolean
  /** Number of times the CLI has been started (welcome/announcement gating). */
  numStartups: number
  /** Whether the effort-level callout (v1/v2) has been dismissed. */
  effortCalloutDismissed?: boolean
  effortCalloutV2Dismissed?: boolean
  /** Id of the last emergency tip shown, so it isn't repeated. */
  lastShownEmergencyTip?: string
  /** Version whose release notes were last shown on the welcome screen. */
  lastReleaseNotesSeen?: string
  /** Whether the user has ever backgrounded a session (Ctrl+B hint gating). */
  hasUsedBackgroundTask?: boolean
  /** Persisted UI toggles mirrored from app state. */
  showExpandedTodos?: boolean
  showSpinnerTree?: boolean
  verbose?: boolean
  tungstenPanelVisible?: boolean
  /** Whether to auto-install the IDE extension when a supported IDE is found. */
  autoInstallIdeExtension?: boolean
  /** Per-project config keyed by absolute project path (onboarding state, MCP
   *  toggles, persisted session costs). Mirrors upstream's nesting of project
   *  config inside the global config file so it survives across processes. */
  projects?: Record<string, ProjectConfig>
}

export type EditorMode = 'emacs' | 'normal' | 'vim'

// A named output style (built-in or user/plugin-defined). The registry of
// style definitions lands with the output-style phase; the id is a string.
export type OutputStyle = string

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  theme: 'dark',
  autoCompactEnabled: true,
  preferredNotifChannel: 'auto',
  numStartups: 0,
  messageIdleNotifThresholdMs: 60000,
  btwUseCount: 0,
  // Boolean toggles the settings panel renders via `value.toString()`. They
  // must be defined here — an absent key surfaces as `undefined.toString()`,
  // which throws when /config opens.
  terminalProgressBarEnabled: true,
  showTurnDuration: true,
  respectGitignore: true,
  copyFullResponse: false,
  fileCheckpointingEnabled: true,
}

function globalConfigPath(): string {
  return join(getKnightcodeConfigHomeDir(), 'config.json')
}

let cachedConfig: GlobalConfig | undefined

export function getGlobalConfig(): GlobalConfig {
  if (cachedConfig) return cachedConfig
  try {
    if (existsSync(globalConfigPath())) {
      cachedConfig = {
        ...DEFAULT_GLOBAL_CONFIG,
        ...(JSON.parse(readFileSync(globalConfigPath(), 'utf8')) as Partial<GlobalConfig>),
      }
      return cachedConfig
    }
  } catch {
    // Corrupt config falls back to defaults; the next save rewrites it.
  }
  cachedConfig = { ...DEFAULT_GLOBAL_CONFIG }
  return cachedConfig
}

export function saveGlobalConfig(
  configOrUpdate: GlobalConfig | ((current: GlobalConfig) => GlobalConfig),
): void {
  const config =
    typeof configOrUpdate === 'function'
      ? configOrUpdate(getGlobalConfig())
      : configOrUpdate
  cachedConfig = config
  try {
    mkdirSync(getKnightcodeConfigHomeDir(), { recursive: true })
    writeFileSync(globalConfigPath(), JSON.stringify(config, null, 2) + '\n')
  } catch {
    // Persisting config is best-effort; the in-memory value still applies.
  }
}

// TODO: the full memory-file layout (managed/auto/team memory) is not
// implemented yet. Compaction reads these paths only to exclude memory files
// from post-compact restoration; the cases that resolve to real on-disk files
// are accurate, and the deferred kinds resolve under the config dir.
export function getMemoryPath(memoryType: MemoryType): string {
  const cwd = getOriginalCwd()
  switch (memoryType) {
    case 'User':
      return join(getKnightcodeConfigHomeDir(), 'KNIGHTCODE.md')
    case 'Local':
      return join(cwd, 'KNIGHTCODE.local.md')
    case 'Project':
      return join(cwd, 'KNIGHTCODE.md')
    case 'Managed':
    case 'AutoMem':
      return join(getKnightcodeConfigHomeDir(), 'KNIGHTCODE.md')
  }
  return join(getKnightcodeConfigHomeDir(), 'KNIGHTCODE.md')
}

export function getManagedKnightcodeRulesDir(): string {
  return join(getManagedFilePath(), '.knightcode', 'rules')
}

export function getUserKnightcodeRulesDir(): string {
  return join(getKnightcodeConfigHomeDir(), 'rules')
}

export function getOrCreateUserID(): string {
  const config = getGlobalConfig()
  if (config.userID) {
    return config.userID
  }

  const userID = randomBytes(32).toString('hex')
  saveGlobalConfig(current => ({ ...current, userID }))
  return userID
}

// Per-project config (onboarding state, MCP toggles, persisted session costs).
// Stored on disk inside the global config's `projects` map, keyed by absolute
// project path, so it survives across processes (needed for --resume to restore
// accumulated cost). Mirrors upstream's config nesting.
export type ProjectConfig = {
  hasCompletedProjectOnboarding?: boolean
  projectOnboardingSeenCount: number
  /** Cached frequently-modified files used to seed example prompts. */
  exampleFiles?: string[]
  /** Epoch ms when exampleFiles was last refreshed. */
  exampleFilesGeneratedAt?: number
  /** Project-scoped MCP servers (`.mcp.json` / local config). */
  mcpServers?: Record<string, McpServerConfig>
  /** Per-project MCP server enable/disable lists (toggled from the MCP UI). */
  enabledMcpServers?: string[]
  disabledMcpServers?: string[]
  /** Whether the user has approved memory files that @include paths outside cwd. */
  hasKnightcodeMdExternalIncludesApproved?: boolean
  /** Whether the external-includes warning has already been shown this project. */
  hasKnightcodeMdExternalIncludesWarningShown?: boolean
  // ── Persisted session cost/usage (written by cost-tracker on exit/switch,
  //    read back on resume by restoreCostStateForSession). Keyed by the last
  //    session that ran in this project so only a matching --resume restores. ──
  /** Session id the cost figures below belong to. */
  lastSessionId?: string
  /** Total accumulated cost (USD) of the last session. */
  lastCost?: number
  /** Wall-clock duration (ms) of the last session. */
  lastDuration?: number
  /** Cumulative API request duration (ms) of the last session. */
  lastAPIDuration?: number
  /** Cumulative API request duration excluding retries (ms). */
  lastAPIDurationWithoutRetries?: number
  /** Cumulative in-tool duration (ms) of the last session. */
  lastToolDuration?: number
  /** Lines added/removed across the last session. */
  lastLinesAdded?: number
  lastLinesRemoved?: number
  /** Aggregate token counts of the last session. */
  lastTotalInputTokens?: number
  lastTotalOutputTokens?: number
  lastTotalCacheCreationInputTokens?: number
  lastTotalCacheReadInputTokens?: number
  lastTotalWebSearchRequests?: number
  /** Per-model usage breakdown of the last session (context windows recomputed
   *  on restore, so only the raw counts + cost are stored). */
  lastModelUsage?: Record<string, StoredModelUsage>
  [key: string]: unknown
}

/** Per-model usage as persisted in project config (no derived fields). */
export type StoredModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
}

const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  projectOnboardingSeenCount: 0,
}

// Absolute, NFC-normalized key under which this project's config is stored in
// the global config's `projects` map.
function getProjectPathForConfig(): string {
  return resolve(process.cwd()).normalize('NFC')
}

export function getCurrentProjectConfig(): ProjectConfig {
  const projects = getGlobalConfig().projects
  return projects?.[getProjectPathForConfig()] ?? { ...DEFAULT_PROJECT_CONFIG }
}

export function saveCurrentProjectConfig(
  updater: (current: ProjectConfig) => ProjectConfig,
): void {
  const absolutePath = getProjectPathForConfig()
  saveGlobalConfig(current => {
    const currentProjectConfig =
      current.projects?.[absolutePath] ?? DEFAULT_PROJECT_CONFIG
    const newProjectConfig = updater(currentProjectConfig)
    // No-op when the updater returns the same reference (matches upstream).
    if (newProjectConfig === currentProjectConfig) return current
    return {
      ...current,
      projects: { ...current.projects, [absolutePath]: newProjectConfig },
    }
  })
}

// TODO: the workspace-trust gate lands with the trust dialog. A local BYOK
// session runs in a directory the user launched it from, so trust is treated
// as accepted until the dialog is wired.
export function checkHasTrustDialogAccepted(): boolean {
  return true
}

// TODO: remote-control + auto-updater gating are out of scope for a BYOK build.
export function getRemoteControlAtStartup(): boolean { return false }
export function getAutoUpdaterDisabledReason(): any { return null }
export function formatAutoUpdaterDisabledReason(_reason: any): string { return '' }

export function getGlobalConfigWriteCount(): number { return 0 }

export function getOpenRouterFavorites(): string[] {
  return getGlobalConfig().openRouterFavorites ?? []
}

export function toggleOpenRouterFavorite(id: string): void {
  saveGlobalConfig(current => {
    const favorites = current.openRouterFavorites ?? []
    const nextFavorites = favorites.includes(id)
      ? favorites.filter(fav => fav !== id)
      : [...favorites, id]
    return {
      ...current,
      openRouterFavorites: nextFavorites,
    }
  })
}
