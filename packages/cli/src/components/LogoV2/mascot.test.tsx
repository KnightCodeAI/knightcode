import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../../tui/components/App'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { Knight, type KnightPose } from './Knight'

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

describe('Knight mascot', () => {
  const poses: KnightPose[] = [
    'default',
    'arms-up',
    'look-left',
    'look-right',
  ]
  for (const pose of poses) {
    test(`renders the "${pose}" pose without throwing`, async () => {
      const h = await createTestRenderer({ width: 20, height: 6 })
      createRoot(h.renderer).render(
        <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
          <AppStateProvider>
            <ThemeProvider initialState="dark">
              <Knight pose={pose} />
            </ThemeProvider>
          </AppStateProvider>
        </TuiApp>,
      )
      const frame = await waitForFrame(h, f => f.trim().length > 0)
      expect(frame.trim().length).toBeGreaterThan(0)
    })
  }
})
