import { describe, expect, test } from 'bun:test'
import { EMPTY_USAGE } from '../../services/api/emptyUsage.js'
import type { AppState } from '../../state/AppState.js'
import { createTaskStateBase } from '../../Task.js'
import { createAssistantMessage } from '../../utils/messages.js'
import {
  appendMessageToLocalAgent,
  completeAgentTask,
  createProgressTracker,
  drainPendingMessages,
  failAgentTask,
  getProgressUpdate,
  getTokenCountFromTracker,
  isLocalAgentTask,
  isPanelAgentTask,
  killAsyncAgent,
  type LocalAgentTaskState,
  markAgentsNotified,
  queuePendingMessage,
  updateAgentProgress,
  updateProgressFromMessage,
} from './LocalAgentTask.js'

// Minimal mutable AppState harness — the runtime mutators only touch `tasks`.
function makeStateHarness(initial: Record<string, LocalAgentTaskState> = {}) {
  let state = { tasks: { ...initial } } as unknown as AppState
  const setAppState = (f: (prev: AppState) => AppState) => {
    state = f(state)
  }
  const getAppState = () => state
  return {
    setAppState,
    getAppState,
    get: (id: string) => state.tasks[id] as LocalAgentTaskState | undefined,
  }
}

function makeTask(
  id: string,
  overrides: Partial<LocalAgentTaskState> = {},
): LocalAgentTaskState {
  return {
    ...createTaskStateBase(id, 'local_agent', overrides.description ?? 'desc'),
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

describe('LocalAgentTask guards', () => {
  test('isLocalAgentTask narrows by type', () => {
    expect(isLocalAgentTask(makeTask('a1'))).toBe(true)
    expect(isLocalAgentTask({ type: 'local_bash' })).toBe(false)
    expect(isLocalAgentTask(null)).toBe(false)
  })

  test('isPanelAgentTask excludes main-session agents', () => {
    expect(isPanelAgentTask(makeTask('a1'))).toBe(true)
    expect(
      isPanelAgentTask(makeTask('a2', { agentType: 'main-session' })),
    ).toBe(false)
  })
})

describe('ProgressTracker', () => {
  test('keeps latest cumulative input, sums output, counts tool uses', () => {
    const tracker = createProgressTracker()
    updateProgressFromMessage(
      tracker,
      createAssistantMessage({
        content: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { x: 1 } },
        ] as never,
        usage: { ...EMPTY_USAGE, input_tokens: 100, output_tokens: 10 },
      }),
    )
    updateProgressFromMessage(
      tracker,
      createAssistantMessage({
        content: [
          { type: 'tool_use', id: 't2', name: 'Grep', input: { y: 2 } },
        ],
        usage: {
          ...EMPTY_USAGE,
          input_tokens: 250,
          output_tokens: 5,
          cache_read_input_tokens: 50,
        },
      }),
    )
    // latest input (250 + 0 creation + 50 read) + summed output (10 + 5)
    expect(getTokenCountFromTracker(tracker)).toBe(300 + 15)
    expect(tracker.toolUseCount).toBe(2)
    const progress = getProgressUpdate(tracker)
    expect(progress.toolUseCount).toBe(2)
    expect(progress.lastActivity?.toolName).toBe('Grep')
    expect(progress.recentActivities).toHaveLength(2)
  })

  test('omits StructuredOutput from recent activities but still counts it', () => {
    const tracker = createProgressTracker()
    updateProgressFromMessage(
      tracker,
      createAssistantMessage({
        content: [
          { type: 'tool_use', id: 's1', name: 'StructuredOutput', input: {} },
        ],
        usage: { ...EMPTY_USAGE, input_tokens: 1, output_tokens: 1 },
      }),
    )
    expect(tracker.toolUseCount).toBe(1)
    expect(tracker.recentActivities).toHaveLength(0)
  })

  test('caps recent activities at 5', () => {
    const tracker = createProgressTracker()
    for (let i = 0; i < 8; i++) {
      updateProgressFromMessage(
        tracker,
        createAssistantMessage({
          content: [
            { type: 'tool_use', id: `t${i}`, name: 'Read', input: { i } },
          ],
          usage: { ...EMPTY_USAGE, input_tokens: 1, output_tokens: 1 },
        }),
      )
    }
    expect(tracker.toolUseCount).toBe(8)
    expect(tracker.recentActivities).toHaveLength(5)
    // Oldest dropped: window is the last 5 (i=3..7)
    expect(tracker.recentActivities[0]!.input).toEqual({ i: 3 })
  })

  test('ignores non-assistant messages', () => {
    const tracker = createProgressTracker()
    updateProgressFromMessage(tracker, {
      type: 'user',
    } as never)
    expect(tracker.toolUseCount).toBe(0)
    expect(getTokenCountFromTracker(tracker)).toBe(0)
  })
})

describe('pending message queue', () => {
  test('queue then drain returns FIFO and clears the queue', () => {
    const h = makeStateHarness({ a1: makeTask('a1') })
    queuePendingMessage('a1', 'first', h.setAppState)
    queuePendingMessage('a1', 'second', h.setAppState)
    expect(h.get('a1')!.pendingMessages).toEqual(['first', 'second'])
    const drained = drainPendingMessages('a1', h.getAppState, h.setAppState)
    expect(drained).toEqual(['first', 'second'])
    expect(h.get('a1')!.pendingMessages).toEqual([])
  })

  test('drain on empty queue returns []', () => {
    const h = makeStateHarness({ a1: makeTask('a1') })
    expect(drainPendingMessages('a1', h.getAppState, h.setAppState)).toEqual([])
  })

  test('appendMessageToLocalAgent appends to the display transcript', () => {
    const h = makeStateHarness({ a1: makeTask('a1') })
    appendMessageToLocalAgent(
      'a1',
      createAssistantMessage({ content: 'hello' }),
      h.setAppState,
    )
    expect(h.get('a1')!.messages).toHaveLength(1)
  })
})

describe('terminal transitions', () => {
  test('completeAgentTask only transitions a running task', () => {
    const h = makeStateHarness({ a1: makeTask('a1') })
    const result = {
      agentId: 'a1',
      content: [{ type: 'text' as const, text: 'done' }],
    } as never
    completeAgentTask(result, h.setAppState)
    expect(h.get('a1')!.status).toBe('completed')
    expect(h.get('a1')!.endTime).toBeGreaterThan(0)

    // Idempotent: a non-running task is left untouched.
    failAgentTask('a1', 'boom', h.setAppState)
    expect(h.get('a1')!.status).toBe('completed')
  })

  test('failAgentTask records the error', () => {
    const h = makeStateHarness({ a1: makeTask('a1') })
    failAgentTask('a1', 'kaboom', h.setAppState)
    expect(h.get('a1')!.status).toBe('failed')
    expect(h.get('a1')!.error).toBe('kaboom')
  })

  test('killAsyncAgent aborts and marks killed; no-op when not running', () => {
    const ac = new AbortController()
    const h = makeStateHarness({ a1: makeTask('a1', { abortController: ac }) })
    killAsyncAgent('a1', h.setAppState)
    expect(ac.signal.aborted).toBe(true)
    expect(h.get('a1')!.status).toBe('killed')

    // Already terminal — second kill is inert.
    killAsyncAgent('a1', h.setAppState)
    expect(h.get('a1')!.status).toBe('killed')
  })
})

describe('notification + progress flags', () => {
  test('markAgentsNotified sets notified once', () => {
    const h = makeStateHarness({ a1: makeTask('a1') })
    markAgentsNotified('a1', h.setAppState)
    expect(h.get('a1')!.notified).toBe(true)
  })

  test('updateAgentProgress preserves an existing background summary', () => {
    const h = makeStateHarness({
      a1: makeTask('a1', {
        progress: { toolUseCount: 0, tokenCount: 0, summary: 'keep me' },
      }),
    })
    updateAgentProgress('a1', { toolUseCount: 3, tokenCount: 42 }, h.setAppState)
    expect(h.get('a1')!.progress?.summary).toBe('keep me')
    expect(h.get('a1')!.progress?.toolUseCount).toBe(3)
  })

  test('updateAgentProgress is a no-op on a non-running task', () => {
    const h = makeStateHarness({ a1: makeTask('a1', { status: 'completed' }) })
    updateAgentProgress('a1', { toolUseCount: 9, tokenCount: 9 }, h.setAppState)
    expect(h.get('a1')!.progress).toBeUndefined()
  })
})
