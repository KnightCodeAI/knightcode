// Session cost / usage ledger. The accumulator lives in bootstrap/state.ts
// (single source of truth, shared with the telemetry getters); this module is
// the cost-facing facade the API client, statusline, /cost command and on-exit
// hook consume.

import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  addToTotalCostState,
  addToTotalLinesChanged as addToTotalLinesChangedState,
  getModelUsage,
  getTotalCostUSD,
  getTotalDuration as getTotalDurationState,
  getTotalInputTokens as getTotalInputTokensState,
  getTotalLinesAdded as getTotalLinesAddedState,
  getTotalLinesRemoved as getTotalLinesRemovedState,
  getTotalOutputTokens as getTotalOutputTokensState,
} from './bootstrap/state.js'

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

// TODO: per-session cost persistence to project config lands with the session-
// storage layer (getStoredSessionCosts/saveCurrentSessionCosts read/write the
// project config's lastCost/lastModelUsage). The live in-memory ledger above is
// authoritative for the current session; setCostStateForRestore seeds it on
// resume once storage can supply the stored totals.
export function getStoredSessionCosts(_sessionId: string): any {
  return null
}
export function restoreCostStateForSession(_sessionId: string): boolean {
  return false
}
export function saveCurrentSessionCosts(_fpsMetrics?: unknown): void {}
export function resetCostState(): void {}
