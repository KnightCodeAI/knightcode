import { describe, expect, test } from 'bun:test'
import { createInkTestRenderer } from '../tui/testing'
import React from 'react'
import { AppStateProvider } from '../state/AppState'
import { ThemeProvider } from './design-system/ThemeProvider'
import { Markdown } from './Markdown'

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

describe('Markdown', () => {
  test('renders bold text and a fenced code block', async () => {
    const h = createInkTestRenderer({ width: 50, height: 10 })
    const md = ['Hello **bold** world', '', '```', 'const x = 42', '```'].join(
      '\n',
    )
    h.render(
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <Markdown>{md}</Markdown>
          </ThemeProvider>
        </AppStateProvider>
      ,
    )

    const frame = await waitForFrame(
      h,
      f => f.includes('bold') && f.includes('const x = 42'),
    )
    expect(frame).toContain('bold')
    expect(frame).toContain('Hello')
    expect(frame).toContain('const x = 42')
  })
})
