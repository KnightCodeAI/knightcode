import { describe, expect, test } from 'bun:test'
import { createInkTestRenderer } from '../../tui/testing'
import React from 'react'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { WelcomeV2 } from './WelcomeV2'

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

describe('WelcomeV2', () => {
  test('shows the KnightCode welcome banner', async () => {
    const h = createInkTestRenderer({ width: 60, height: 12 })
    h.render(
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <WelcomeV2 />
          </ThemeProvider>
        </AppStateProvider>
      ,
    )

    const frame = await waitForFrame(h, f => f.includes('KnightCode'))
    expect(frame).toContain('KnightCode')
  })
})
