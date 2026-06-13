import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../../tui/components/App'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { GlimmerMessage } from './GlimmerMessage'
import { getDefaultCharacters, interpolateColor } from './utils'

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

describe('Spinner suite', () => {
  test('the default glyph set is non-empty animation frames', () => {
    const chars = getDefaultCharacters()
    expect(chars.length).toBeGreaterThan(1)
    // The asterisk family is the recognizable spinner cadence.
    expect(chars).toContain('·')
  })

  test('interpolateColor walks from one rgb to another', () => {
    const mid = interpolateColor(
      { r: 0, g: 0, b: 0 },
      { r: 100, g: 200, b: 50 },
      0.5,
    )
    expect(mid).toEqual({ r: 50, g: 100, b: 25 })
  })

  test('GlimmerMessage renders its message text', async () => {
    const h = await createTestRenderer({ width: 40, height: 4 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <ThemeProvider initialState="dark">
          <GlimmerMessage
            message="Thinking"
            mode="thinking"
            messageColor="suggestion"
            glimmerIndex={0}
            flashOpacity={1}
            shimmerColor="suggestion"
          />
        </ThemeProvider>
      </TuiApp>,
    )

    // Each grapheme renders as its own shimmer cell, so the message can wrap;
    // collapse whitespace before asserting the text is present.
    const frame = await waitForFrame(h, f =>
      f.replace(/\s/g, '').includes('Thinking'),
    )
    expect(frame.replace(/\s/g, '')).toContain('Thinking')
  })
})
