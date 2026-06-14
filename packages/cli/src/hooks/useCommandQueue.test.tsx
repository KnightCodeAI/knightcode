import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../tui/components/App'
import { Text } from '../tui'
import { AppStateProvider } from '../state/AppState'
import { ThemeProvider } from '../components/design-system/ThemeProvider'
import {
  dequeue,
  enqueue,
  getCommandQueueSnapshot,
  resetCommandQueue,
} from '../utils/messageQueueManager'
import { useCommandQueue } from './useCommandQueue'

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))

type Harness = Awaited<ReturnType<typeof createTestRenderer>>

async function waitForFrame(
  h: Harness,
  predicate: (frame: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let frame = ''
  while (Date.now() < deadline) {
    await h.renderOnce()
    frame = h.captureCharFrame()
    if (predicate(frame)) return frame
    await tick()
  }
  throw new Error(`frame never satisfied predicate; last frame:\n${frame}`)
}

// Renders the live queue as a single line so the frame reflects the hook's
// view of the shared command queue.
function QueueProbe() {
  const queue = useCommandQueue()
  const text = queue
    .map(c => (typeof c.value === 'string' ? c.value : '[blocks]'))
    .join('|')
  return <Text>{`[${text}]`}</Text>
}

describe('useCommandQueue', () => {
  beforeEach(() => {
    resetCommandQueue()
  })

  // Leave the shared module-level queue empty so this test never pollutes
  // others that read the same queue.
  afterEach(() => {
    resetCommandQueue()
  })

  test('reflects enqueued commands and drops the one consumed by dequeue', async () => {
    const h = await createTestRenderer({ width: 40, height: 4 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <QueueProbe />
          </ThemeProvider>
        </AppStateProvider>
      </TuiApp>,
    )

    // Starts empty.
    await waitForFrame(h, f => f.includes('[]'))

    // Enqueue a normal-priority command then a higher-priority ('now') one.
    // The snapshot preserves insertion order; priority governs dequeue.
    enqueue({ value: 'first', mode: 'prompt' })
    enqueue({ value: 'urgent', mode: 'prompt', priority: 'now' })

    await waitForFrame(h, f => f.includes('[first|urgent]'))

    // Highest priority is dequeued first ('now' beats the default 'next').
    const consumed = dequeue()
    expect(consumed?.value).toBe('urgent')

    // The hook re-renders without the consumed command.
    await waitForFrame(h, f => f.includes('[first]') && !f.includes('urgent'))
    expect(getCommandQueueSnapshot().map(c => c.value)).toEqual(['first'])
  })
})
