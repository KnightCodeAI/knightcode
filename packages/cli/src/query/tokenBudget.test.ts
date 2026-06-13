import { describe, expect, test } from 'bun:test'
import {
  checkTokenBudget,
  createBudgetTracker,
  type BudgetTracker,
} from './tokenBudget.js'

describe('createBudgetTracker', () => {
  test('starts with zeroed counters and a start timestamp', () => {
    const before = Date.now()
    const tracker = createBudgetTracker()
    expect(tracker.continuationCount).toBe(0)
    expect(tracker.lastDeltaTokens).toBe(0)
    expect(tracker.lastGlobalTurnTokens).toBe(0)
    expect(tracker.startedAt).toBeGreaterThanOrEqual(before)
  })
})

describe('checkTokenBudget — disabled cases stop immediately', () => {
  test('subagent (agentId set) stops with no completion event', () => {
    const tracker = createBudgetTracker()
    const decision = checkTokenBudget(tracker, 'agent-1', 10_000, 100)
    expect(decision.action).toBe('stop')
    if (decision.action === 'stop') {
      expect(decision.completionEvent).toBeNull()
    }
    // Disabled path must not mutate the tracker.
    expect(tracker.continuationCount).toBe(0)
  })

  test('null budget stops with no completion event', () => {
    const tracker = createBudgetTracker()
    const decision = checkTokenBudget(tracker, undefined, null, 100)
    expect(decision.action).toBe('stop')
    if (decision.action === 'stop') {
      expect(decision.completionEvent).toBeNull()
    }
  })

  test('non-positive budget stops with no completion event', () => {
    const tracker = createBudgetTracker()
    const decision = checkTokenBudget(tracker, undefined, 0, 100)
    expect(decision.action).toBe('stop')
    if (decision.action === 'stop') {
      expect(decision.completionEvent).toBeNull()
    }
  })
})

describe('checkTokenBudget — under an ample budget', () => {
  test('continues, increments the count, and reports progress', () => {
    const tracker = createBudgetTracker()
    const decision = checkTokenBudget(tracker, undefined, 10_000, 1_000)
    expect(decision.action).toBe('continue')
    if (decision.action === 'continue') {
      expect(decision.continuationCount).toBe(1)
      expect(decision.pct).toBe(10)
      expect(decision.turnTokens).toBe(1_000)
      expect(decision.budget).toBe(10_000)
      expect(decision.nudgeMessage).toContain('10%')
    }
    // Tracker state advances so the next check can measure the delta.
    expect(tracker.continuationCount).toBe(1)
    expect(tracker.lastGlobalTurnTokens).toBe(1_000)
    expect(tracker.lastDeltaTokens).toBe(1_000)
  })
})

describe('checkTokenBudget — crossing the completion threshold', () => {
  test('stops with a completion event when prior continuations exist', () => {
    const tracker: BudgetTracker = {
      continuationCount: 2,
      lastDeltaTokens: 1_000,
      lastGlobalTurnTokens: 8_000,
      startedAt: Date.now() - 5_000,
    }
    const decision = checkTokenBudget(tracker, undefined, 10_000, 9_500)
    expect(decision.action).toBe('stop')
    if (decision.action === 'stop') {
      expect(decision.completionEvent).not.toBeNull()
      expect(decision.completionEvent?.continuationCount).toBe(2)
      expect(decision.completionEvent?.pct).toBe(95)
      expect(decision.completionEvent?.turnTokens).toBe(9_500)
      expect(decision.completionEvent?.budget).toBe(10_000)
      expect(decision.completionEvent?.diminishingReturns).toBe(false)
      expect(decision.completionEvent?.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  test('stops with no completion event on the very first over-threshold check', () => {
    const tracker = createBudgetTracker()
    const decision = checkTokenBudget(tracker, undefined, 10_000, 9_500)
    expect(decision.action).toBe('stop')
    if (decision.action === 'stop') {
      expect(decision.completionEvent).toBeNull()
    }
  })
})

describe('checkTokenBudget — diminishing returns', () => {
  test('stops even below threshold when deltas have shrunk after 3+ continuations', () => {
    const tracker: BudgetTracker = {
      continuationCount: 3,
      lastDeltaTokens: 100,
      lastGlobalTurnTokens: 5_000,
      startedAt: Date.now() - 1_000,
    }
    const decision = checkTokenBudget(tracker, undefined, 100_000, 5_200)
    expect(decision.action).toBe('stop')
    if (decision.action === 'stop') {
      expect(decision.completionEvent).not.toBeNull()
      expect(decision.completionEvent?.diminishingReturns).toBe(true)
      expect(decision.completionEvent?.continuationCount).toBe(3)
    }
  })
})
