// TODO: the auto-memory directory feature isn't ported. These inert checks let
// the permission layer treat no path as an auto-memory path until it lands.

import { homedir } from 'os'
import { join, sep } from 'path'
import { getIsNonInteractiveSession } from '../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'

export function hasAutoMemPathOverride(): boolean {
  return false
}

export function isAutoMemPath(_absolutePath: string): boolean {
  return false
}

// TODO: auto-memory storage isn't implemented yet. isAutoMemoryEnabled reports
// disabled so the relevant-memory prefetch and turn-end extraction stay off;
// getAutoMemPath still yields a stable directory for callers that compute it
// before the gate check.
export function getAutoMemPath(): string {
  const home = (
    process.env.KNIGHTCODE_CONFIG_DIR ??
    join(homedir(), '.knightcode')
  ).normalize('NFC')
  return join(home, 'memory') + sep
}

// Base directory memory files live under (the config home, or a remote override).
export function getMemoryBaseDir(): string {
  if (process.env.KNIGHTCODE_REMOTE_MEMORY_DIR) {
    return process.env.KNIGHTCODE_REMOTE_MEMORY_DIR
  }
  return (
    process.env.KNIGHTCODE_CONFIG_DIR ?? join(homedir(), '.knightcode')
  ).normalize('NFC')
}

export function isAutoMemoryEnabled(): boolean {
  return false
}

/**
 * Whether the extract-memories background agent will run this session.
 *
 * The main agent's prompt always has full save instructions regardless of
 * this gate — when the main agent writes memories, the background agent
 * skips that range (hasMemoryWritesSince in extractMemories.ts); when it
 * doesn't, the background agent catches anything missed.
 *
 * Callers must also gate on feature('EXTRACT_MEMORIES') — that check cannot
 * live inside this helper because feature() only tree-shakes when used
 * directly in an `if` condition.
 */
export function isExtractModeActive(): boolean {
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_passport_quail', false)) {
    return false
  }
  return (
    !getIsNonInteractiveSession() ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_slate_thimble', false)
  )
}
