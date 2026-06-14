import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../../tui/components/App'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { HooksConfigMenu } from './HooksConfigMenu'

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

describe('HooksConfigMenu', () => {
  test('renders the hook configuration dialog', async () => {
    const h = await createTestRenderer({ width: 80, height: 20 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <HooksConfigMenu toolNames={['Bash', 'Edit']} onExit={() => {}} />
          </ThemeProvider>
        </AppStateProvider>
      </TuiApp>,
    )
    // With hooks enabled (default), the menu opens on the event-selection step.
    const frame = await waitForFrame(h, f => f.includes('Hooks'))
    expect(frame).toContain('Hooks')
  })
})
