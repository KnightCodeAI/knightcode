import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { getOriginalCwd } from '../bootstrap/state.js'
import { getClaudeConfigHomeDir } from './envUtils.js'
import type { MemoryType } from './memory/types.js'
import type { ThemeSetting } from './theme.js'
import type { ImageDimensions } from './imageResizer.js'
import type { StoredCompanion } from '../buddy/types.js'

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
  oauthAccount?: { accountUuid?: string; [key: string]: unknown }
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
}

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  theme: 'dark',
  autoCompactEnabled: true,
}

function globalConfigPath(): string {
  return join(getClaudeConfigHomeDir(), 'config.json')
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
    mkdirSync(getClaudeConfigHomeDir(), { recursive: true })
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
      return join(getClaudeConfigHomeDir(), 'CLAUDE.md')
    case 'Local':
      return join(cwd, 'CLAUDE.local.md')
    case 'Project':
      return join(cwd, 'CLAUDE.md')
    case 'Managed':
    case 'AutoMem':
      return join(getClaudeConfigHomeDir(), 'CLAUDE.md')
  }
  return join(getClaudeConfigHomeDir(), 'CLAUDE.md')
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

// TODO: per-project config persistence (onboarding state, project history,
// trust) lands with the config layer. This keeps an in-memory project config
// keyed by cwd so onboarding bookkeeping works within a session; it is not yet
// written to disk.
export type ProjectConfig = {
  hasCompletedProjectOnboarding?: boolean
  projectOnboardingSeenCount: number
  [key: string]: unknown
}

const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  projectOnboardingSeenCount: 0,
}

const projectConfigByDir = new Map<string, ProjectConfig>()

export function getCurrentProjectConfig(): ProjectConfig {
  const cwd = process.cwd().normalize('NFC')
  return projectConfigByDir.get(cwd) ?? { ...DEFAULT_PROJECT_CONFIG }
}

export function saveCurrentProjectConfig(
  updater: (current: ProjectConfig) => ProjectConfig,
): void {
  const cwd = process.cwd().normalize('NFC')
  projectConfigByDir.set(cwd, updater(getCurrentProjectConfig()))
}
