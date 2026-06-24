import { describe, expect, test } from 'bun:test'
import { createInkTestRenderer } from '../../tui/testing'
import React from 'react'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { HooksConfigMenu } from './HooksConfigMenu'

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))
type Harness = ReturnType<typeof createInkTestRenderer>

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
    const h = createInkTestRenderer({ width: 80, height: 20 })
    h.render(
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <HooksConfigMenu toolNames={['Bash', 'Edit']} onExit={() => {}} />
          </ThemeProvider>
        </AppStateProvider>
      ,
    )
    // With hooks enabled (default), the menu opens on the event-selection step.
    const frame = await waitForFrame(h, f => f.includes('Hooks'))
    expect(frame).toContain('Hooks')
  })
})
