import { describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState.js'
import { createTaskStateBase } from '../../Task.js'
import type { LocalAgentTaskState } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import {
  evictTerminalTask,
  getRunningTasks,
  PANEL_GRACE_MS,
  registerTask,
  updateTaskState,
} from './framework.js'

function makeStateHarness(initial: Record<string, LocalAgentTaskState> = {}) {
  let state = { tasks: { ...initial } } as unknown as AppState
  const setAppState = (f: (prev: AppState) => AppState) => {
    state = f(state)
  }
  return {
    setAppState,
    getAppState: () => state,
    get: (id: string) =>
      state.tasks[id] as LocalAgentTaskState | undefined,
  }
}

function makeTask(
  id: string,
  overrides: Partial<LocalAgentTaskState> = {},
): LocalAgentTaskState {
  return {
    ...createTaskStateBase(id, 'local_agent', 'desc'),
    type: 'local_agent',
    status: 'running',
    agentId: id,
    prompt: 'p',
    agentType: 'general-purpose',
    retrieved: false,
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    isBackgrounded: true,
    pendingMessages: [],
    retain: false,
    diskLoaded: false,
    ...overrides,
  }
}

describe('updateTaskState', () => {
  test('applies the updater and returns a new task reference', () => {
    const h = makeStateHarness({ a1: makeTask('a1') })
    updateTaskState<LocalAgentTaskState>('a1', h.setAppState, t => ({
      ...t,
      prompt: 'changed',
    }))
    expect(h.get('a1')!.prompt).toBe('changed')
  })

  test('skips the spread when the updater returns the same reference', () => {
    const h = makeStateHarness({ a1: makeTask('a1') })
    const before = h.getAppState()
    updateTaskState<LocalAgentTaskState>('a1', h.setAppState, t => t)
    // Same prev reference returned → subscribers do not re-render.
    expect(h.getAppState()).toBe(before)
  })

  test('is a no-op for an unknown task id', () => {
    const h = makeStateHarness({ a1: makeTask('a1') })
    updateTaskState<LocalAgentTaskState>('missing', h.setAppState, t => ({
      ...t,
      prompt: 'x',
    }))
    expect(h.get('a1')!.prompt).toBe('p')
  })
})

describe('registerTask', () => {
  test('inserts a brand-new task', () => {
    const h = makeStateHarness()
    registerTask(makeTask('a1'), h.setAppState)
    expect(h.get('a1')!.agentId).toBe('a1')
  })

  test('on re-register (resume) carries forward UI-held state', () => {
    const existing = makeTask('a1', {
      retain: true,
      diskLoaded: true,
      startTime: 1234,
      messages: [],
      pendingMessages: ['queued'],
    })
    const h = makeStateHarness({ a1: existing })
    // Resume replaces the task but the user's retain/transcript must survive.
    registerTask(makeTask('a1', { prompt: 'resumed', startTime: 9999 }), h.setAppState)
    const merged = h.get('a1')!
    expect(merged.prompt).toBe('resumed')
    expect(merged.retain).toBe(true)
    expect(merged.diskLoaded).toBe(true)
    expect(merged.startTime).toBe(1234)
    expect(merged.pendingMessages).toEqual(['queued'])
  })
})

describe('evictTerminalTask', () => {
  test('evicts a terminal + notified task past its grace deadline', () => {
    const h = makeStateHarness({
      a1: makeTask('a1', {
        status: 'completed',
        notified: true,
        evictAfter: Date.now() - 1,
      }),
    })
    evictTerminalTask('a1', h.setAppState)
    expect(h.get('a1')).toBeUndefined()
  })

  test('does not evict a notified task still inside its panel grace window', () => {
    const h = makeStateHarness({
      a1: makeTask('a1', {
        status: 'completed',
        notified: true,
        evictAfter: Date.now() + PANEL_GRACE_MS,
      }),
    })
    evictTerminalTask('a1', h.setAppState)
    expect(h.get('a1')).toBeDefined()
  })

  test('does not evict a running task', () => {
    const h = makeStateHarness({
      a1: makeTask('a1', { status: 'running', notified: true }),
    })
    evictTerminalTask('a1', h.setAppState)
    expect(h.get('a1')).toBeDefined()
  })

  test('does not evict a terminal-but-unnotified task', () => {
    const h = makeStateHarness({
      a1: makeTask('a1', { status: 'failed', notified: false }),
    })
    evictTerminalTask('a1', h.setAppState)
    expect(h.get('a1')).toBeDefined()
  })
})

describe('getRunningTasks', () => {
  test('returns only running tasks', () => {
    const h = makeStateHarness({
      a1: makeTask('a1', { status: 'running' }),
      a2: makeTask('a2', { status: 'completed', notified: true }),
      a3: makeTask('a3', { status: 'running' }),
    })
    const running = getRunningTasks(h.getAppState())
    expect(running.map(t => t.id).sort()).toEqual(['a1', 'a3'])
  })
})
