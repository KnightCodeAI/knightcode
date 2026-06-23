import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  addToTotalLinesChanged,
  addToTotalSessionCost,
  formatTotalCost,
  getStoredSessionCosts,
  getTotalCost,
  getTotalInputTokens,
  getTotalLinesAdded,
  getTotalLinesRemoved,
  getTotalOutputTokens,
  resetCostState,
  restoreCostStateForSession,
  saveCurrentSessionCosts,
} from './cost-tracker.js'
import {
  getModelUsage,
  getSessionId,
  getTurnOutputTokens,
  snapshotOutputTokensForTurn,
} from './bootstrap/state.js'

function usage(input: number, output: number): BetaUsage {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  } as BetaUsage
}

describe('cost ledger', () => {
  test('addToTotalSessionCost accumulates cost and tokens, and echoes the cost', () => {
    const before = getTotalCost()
    const returned = addToTotalSessionCost(0.25, usage(100, 40), 'model-a')
    expect(returned).toBe(0.25)
    expect(getTotalCost()).toBeCloseTo(before + 0.25, 10)
    addToTotalSessionCost(0.75, usage(200, 60), 'model-a')
    expect(getTotalCost()).toBeCloseTo(before + 1.0, 10)
    // tokens accumulate across calls for the same model
    expect(getModelUsage()['model-a']?.inputTokens).toBeGreaterThanOrEqual(300)
    expect(getModelUsage()['model-a']?.outputTokens).toBeGreaterThanOrEqual(100)
  })

  test('input/output token totals reflect accumulated usage', () => {
    const inBefore = getTotalInputTokens()
    const outBefore = getTotalOutputTokens()
    addToTotalSessionCost(0, usage(10, 5), 'model-b')
    expect(getTotalInputTokens()).toBe(inBefore + 10)
    expect(getTotalOutputTokens()).toBe(outBefore + 5)
  })

  test('getTurnOutputTokens reports only output since the last snapshot', () => {
    snapshotOutputTokensForTurn(null)
    expect(getTurnOutputTokens()).toBe(0)
    addToTotalSessionCost(0, usage(0, 17), 'model-c')
    expect(getTurnOutputTokens()).toBe(17)
  })

  test('addToTotalLinesChanged accumulates added/removed lines', () => {
    const addedBefore = getTotalLinesAdded()
    const removedBefore = getTotalLinesRemoved()
    addToTotalLinesChanged(7, 3)
    expect(getTotalLinesAdded()).toBe(addedBefore + 7)
    expect(getTotalLinesRemoved()).toBe(removedBefore + 3)
  })

  test('formatTotalCost renders a real total, not $0.00', () => {
    addToTotalSessionCost(1.5, usage(1, 1), 'model-d')
    const out = formatTotalCost()
    expect(out).toContain('Total cost:')
    expect(out).not.toBe('$0.00')
    // cost is well above $0.50 so it renders with 2 decimals
    expect(out).toMatch(/Total cost:\s+\$\d+\.\d{2}/)
  })
})

describe('cross-session cost persistence', () => {
  const prevConfigDir = process.env.KNIGHTCODE_CONFIG_DIR
  // Throwaway config dir so the persisted global config (where project cost
  // state lives) is never written into the real ~/.knightcode.
  const tmpConfigDir = mkdtempSync(join(tmpdir(), 'kc-cost-'))

  beforeEach(() => {
    process.env.KNIGHTCODE_CONFIG_DIR = tmpConfigDir
  })
  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.KNIGHTCODE_CONFIG_DIR
    else process.env.KNIGHTCODE_CONFIG_DIR = prevConfigDir
  })
  afterAll(() => {
    if (prevConfigDir === undefined) delete process.env.KNIGHTCODE_CONFIG_DIR
    else process.env.KNIGHTCODE_CONFIG_DIR = prevConfigDir
  })

  test('save → getStored → restore round-trips the ledger for the same session', () => {
    resetCostState()
    addToTotalSessionCost(2.0, usage(120, 45), 'model-persist')
    addToTotalLinesChanged(9, 4)
    saveCurrentSessionCosts()

    const sid = getSessionId()
    const stored = getStoredSessionCosts(sid)
    expect(stored).toBeDefined()
    expect(stored?.totalCostUSD).toBeCloseTo(2.0, 10)
    expect(stored?.totalLinesAdded).toBe(9)
    expect(stored?.totalLinesRemoved).toBe(4)
    expect(stored?.modelUsage?.['model-persist']?.inputTokens).toBe(120)
    // derived context-window fields are recomputed, not persisted
    expect(stored?.modelUsage?.['model-persist']?.contextWindow).toBeGreaterThan(
      0,
    )

    // Mutate the live ledger, then restore should snap it back to the snapshot.
    addToTotalSessionCost(5.0, usage(1, 1), 'model-persist')
    expect(getTotalCost()).toBeCloseTo(7.0, 10)
    expect(restoreCostStateForSession(sid)).toBe(true)
    expect(getTotalCost()).toBeCloseTo(2.0, 10)
  })

  test('getStored returns undefined for a non-matching session id', () => {
    resetCostState()
    addToTotalSessionCost(1.0, usage(1, 1), 'model-x')
    saveCurrentSessionCosts()
    expect(getStoredSessionCosts('not-the-saved-session')).toBeUndefined()
    expect(restoreCostStateForSession('not-the-saved-session')).toBe(false)
  })
})
