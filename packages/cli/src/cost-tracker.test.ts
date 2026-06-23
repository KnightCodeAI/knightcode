import { describe, expect, test } from 'bun:test'
import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import {
  addToTotalLinesChanged,
  addToTotalSessionCost,
  formatTotalCost,
  getTotalCost,
  getTotalInputTokens,
  getTotalLinesAdded,
  getTotalLinesRemoved,
  getTotalOutputTokens,
} from './cost-tracker.js'
import { getModelUsage, getTurnOutputTokens, snapshotOutputTokensForTurn } from './bootstrap/state.js'

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
