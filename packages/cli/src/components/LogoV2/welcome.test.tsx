import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../../tui/components/App'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { WelcomeV2 } from './WelcomeV2'

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

describe('WelcomeV2', () => {
  test('shows the KnightCode welcome banner', async () => {
    const h = await createTestRenderer({ width: 60, height: 12 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <WelcomeV2 />
          </ThemeProvider>
        </AppStateProvider>
      </TuiApp>,
    )

    const frame = await waitForFrame(h, f => f.includes('KnightCode'))
    expect(frame).toContain('KnightCode')
  })
})
