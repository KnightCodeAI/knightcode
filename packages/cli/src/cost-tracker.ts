// Session cost / usage ledger. The accumulator lives in bootstrap/state.ts
// (single source of truth, shared with the telemetry getters); this module is
// the cost-facing facade the API client, statusline, /cost command and on-exit
// hook consume.

import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  addToTotalCostState,
  addToTotalLinesChanged as addToTotalLinesChangedState,
  getModelUsage,
  getSdkBetas,
  getSessionId,
  getTotalCostUSD,
  getTotalDuration as getTotalDurationState,
  getTotalInputTokens as getTotalInputTokensState,
  getTotalLinesAdded as getTotalLinesAddedState,
  getTotalLinesRemoved as getTotalLinesRemovedState,
  getTotalOutputTokens as getTotalOutputTokensState,
  setCostStateForRestore,
} from './bootstrap/state.js'
import type { ModelUsage } from './entrypoints/agentSdkTypes.js'
import {
  getCurrentProjectConfig,
  saveCurrentProjectConfig,
  type StoredModelUsage,
} from './utils/config.js'
import {
  getContextWindowForModel,
  getModelMaxOutputTokens,
} from './utils/context.js'
import type { FpsMetrics } from './utils/fpsTracker.js'

// Accumulates one API response's cost into the session ledger and returns the
// same cost so callers can keep a local running total.
export function addToTotalSessionCost(
  cost: number,
  usage: BetaUsage,
  model: string,
): number {
  addToTotalCostState(cost, usage, model)
  return cost
}

// The file tools report edit sizes here; forwarded to the shared ledger.
export function addToTotalLinesChanged(
  additions: number,
  removals: number,
): void {
  addToTotalLinesChangedState(additions, removals)
}

export function getTotalCost(): number {
  return getTotalCostUSD()
}

export function getTotalDuration(): number {
  return getTotalDurationState()
}

// API request duration is tracked by the metrics layer, which is not wired up
// in this build; the wall-clock session duration above is the live figure.
export function getTotalAPIDuration(): number {
  return 0
}

export function getTotalInputTokens(): number {
  return getTotalInputTokensState()
}

export function getTotalOutputTokens(): number {
  return getTotalOutputTokensState()
}

export function getTotalLinesAdded(): number {
  return getTotalLinesAddedState()
}

export function getTotalLinesRemoved(): number {
  return getTotalLinesRemovedState()
}

// Format a USD cost for display: 2 decimals above $0.50, finer precision below.
export function formatCost(cost: number, maxDecimalPlaces: number = 4): string {
  return `$${cost > 0.5 ? cost.toFixed(2) : cost.toFixed(maxDecimalPlaces)}`
}

// Multi-line cost/usage summary shown by /cost and the on-exit cost hook.
export function formatTotalCost(): string {
  const durationSec = (getTotalDuration() / 1000).toFixed(1)
  const lines = [
    `Total cost:            ${formatCost(getTotalCost())}`,
    `Total duration:        ${durationSec}s`,
    `Total tokens:          ${getTotalInputTokens()} input, ${getTotalOutputTokens()} output`,
  ]
  const modelUsage = getModelUsage()
  for (const [model, usage] of Object.entries(modelUsage)) {
    lines.push(
      `  ${model}: ${usage.inputTokens} in, ${usage.outputTokens} out, ` +
        `${usage.cacheReadInputTokens} cache read, ` +
        `${usage.cacheCreationInputTokens} cache write`,
    )
  }
  return lines.join('\n')
}

// ── Cross-session cost persistence ───────────────────────────────────────────
// The live in-memory ledger (bootstrap/state) is authoritative for the running
// session. On exit/switch we snapshot it into the project config (persisted on
// disk via the global config's `projects` map); on --resume we read it back and
// seed the ledger via setCostStateForRestore — but only when the stored figures
// belong to the session being resumed.

type StoredCostState = {
  totalCostUSD: number
  totalLinesAdded: number
  totalLinesRemoved: number
  lastDuration: number | undefined
  modelUsage: Record<string, ModelUsage> | undefined
}

/**
 * Reads the persisted cost state for a session from project config. Returns
 * undefined unless the stored figures belong to `sessionId` (so resuming a
 * different session doesn't inherit another session's totals). Call this before
 * saveCurrentSessionCosts() overwrites the config.
 */
export function getStoredSessionCosts(
  sessionId: string,
): StoredCostState | undefined {
  const projectConfig = getCurrentProjectConfig()
  if (projectConfig.lastSessionId !== sessionId) {
    return undefined
  }

  // Rehydrate per-model usage, recomputing the derived context-window fields
  // (those aren't persisted — they depend on the current build's model table).
  let modelUsage: Record<string, ModelUsage> | undefined
  if (projectConfig.lastModelUsage) {
    modelUsage = Object.fromEntries(
      Object.entries(projectConfig.lastModelUsage).map(([model, usage]) => [
        model,
        {
          ...usage,
          contextWindow: getContextWindowForModel(model, getSdkBetas()),
          maxOutputTokens: getModelMaxOutputTokens(model).default,
        },
      ]),
    )
  }

  return {
    totalCostUSD: projectConfig.lastCost ?? 0,
    totalLinesAdded: projectConfig.lastLinesAdded ?? 0,
    totalLinesRemoved: projectConfig.lastLinesRemoved ?? 0,
    lastDuration: projectConfig.lastDuration,
    modelUsage,
  }
}

/**
 * Restores cost state from project config when resuming a session.
 * @returns true if cost state was restored, false otherwise.
 */
export function restoreCostStateForSession(sessionId: string): boolean {
  const data = getStoredSessionCosts(sessionId)
  if (!data) {
    return false
  }
  setCostStateForRestore(data)
  return true
}

/**
 * Snapshots the current session's costs into project config. Call before
 * switching sessions or on exit so accumulated cost survives a later --resume.
 */
export function saveCurrentSessionCosts(fpsMetrics?: FpsMetrics): void {
  const modelUsage = getModelUsage()
  const sum = (field: keyof ModelUsage): number => {
    let total = 0
    for (const usage of Object.values(modelUsage)) total += usage[field]
    return total
  }

  const storedModelUsage: Record<string, StoredModelUsage> = Object.fromEntries(
    Object.entries(modelUsage).map(([model, usage]) => [
      model,
      {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens,
        webSearchRequests: usage.webSearchRequests,
        costUSD: usage.costUSD,
      },
    ]),
  )

  saveCurrentProjectConfig(current => ({
    ...current,
    lastSessionId: getSessionId(),
    lastCost: getTotalCostUSD(),
    lastDuration: getTotalDurationState(),
    lastLinesAdded: getTotalLinesAddedState(),
    lastLinesRemoved: getTotalLinesRemovedState(),
    lastTotalInputTokens: sum('inputTokens'),
    lastTotalOutputTokens: sum('outputTokens'),
    lastTotalCacheCreationInputTokens: sum('cacheCreationInputTokens'),
    lastTotalCacheReadInputTokens: sum('cacheReadInputTokens'),
    lastTotalWebSearchRequests: sum('webSearchRequests'),
    lastFpsAverage: fpsMetrics?.averageFps,
    lastFpsLow1Pct: fpsMetrics?.low1PctFps,
    lastModelUsage: storedModelUsage,
  }))
}

export function resetCostState(): void {
  setCostStateForRestore({
    totalCostUSD: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    modelUsage: {},
  })
}
