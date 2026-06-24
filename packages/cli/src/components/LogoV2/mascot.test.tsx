import { describe, expect, test } from 'bun:test'
import { createInkTestRenderer } from '../../tui/testing'
import React from 'react'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { Knight, type KnightPose } from './Knight'

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

describe('Knight mascot', () => {
  const poses: KnightPose[] = [
    'default',
    'arms-up',
    'look-left',
    'look-right',
  ]
  for (const pose of poses) {
    test(`renders the "${pose}" pose without throwing`, async () => {
      const h = createInkTestRenderer({ width: 20, height: 6 })
      h.render(
          <AppStateProvider>
            <ThemeProvider initialState="dark">
              <Knight pose={pose} />
            </ThemeProvider>
          </AppStateProvider>
        ,
      )
      const frame = await waitForFrame(h, f => f.trim().length > 0)
      expect(frame.trim().length).toBeGreaterThan(0)
    })
  }
})
