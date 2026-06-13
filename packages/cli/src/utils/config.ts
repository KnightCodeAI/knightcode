import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { getClaudeConfigHomeDir } from './envUtils.js'
import type { ThemeSetting } from './theme.js'

// Global (per-user) configuration. Grows as features land; fields with
// defaults are filled in when an older config file omits them.
export type GlobalConfig = {
  theme: ThemeSetting
  /** Random per-install identifier (created on first use). */
  userID?: string
  /** Server-pushed client data; absent until remote config lands. */
  clientDataCache?: Record<string, unknown> | null
}

const DEFAULT_GLOBAL_CONFIG: GlobalConfig = {
  theme: 'dark',
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

export function getOrCreateUserID(): string {
  const config = getGlobalConfig()
  if (config.userID) {
    return config.userID
  }

  const userID = randomBytes(32).toString('hex')
  saveGlobalConfig(current => ({ ...current, userID }))
  return userID
}
