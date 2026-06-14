import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React, { useRef } from 'react'
import TuiApp from '../tui/components/App'
import { AppStateProvider } from '../state/AppState'
import { getDefaultAppState } from '../state/AppStateStore'
import { ThemeProvider } from './design-system/ThemeProvider'
import {
  StatusLine,
  getLastAssistantMessageId,
  statusLineShouldDisplay,
} from './StatusLine'
import type { Message } from '../types/message'

// The statusline paints the rendered output of a user-configured statusLine
// command (a hook). Hook dispatch is inert until the harness wires it, so the
// command never produces output and the chrome renders empty — the same as
// upstream with no command configured. The mount test asserts the chrome
// composes over the renderer without throwing; the pure helpers that gate and
// drive it are covered directly below.

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))

function StatusLineHarness(): React.ReactNode {
  const messagesRef = useRef<Message[]>([])
  return (
    <StatusLine messagesRef={messagesRef} lastAssistantMessageId={null} />
  )
}

describe('StatusLine', () => {
  test('mounts and paints a frame over the renderer', async () => {
    const h = await createTestRenderer({ width: 60, height: 6 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <AppStateProvider initialState={getDefaultAppState()}>
          <ThemeProvider initialState="dark">
            <StatusLineHarness />
          </ThemeProvider>
        </AppStateProvider>
      </TuiApp>,
    )

    await h.renderOnce()
    await tick()
    await h.renderOnce()
    // The chrome mounts and the renderer yields a frame string without throwing.
    expect(typeof h.captureCharFrame()).toBe('string')
  })
})

describe('statusLineShouldDisplay', () => {
  test('false when no statusLine command is configured', () => {
    expect(statusLineShouldDisplay({} as never)).toBe(false)
  })

  test('true when a statusLine command is configured', () => {
    expect(
      statusLineShouldDisplay({ statusLine: { command: 'echo hi' } } as never),
    ).toBe(true)
  })
})

describe('getLastAssistantMessageId', () => {
  test('returns null when there is no assistant message', () => {
    expect(getLastAssistantMessageId([])).toBeNull()
  })
})
