import { describe, expect, test } from 'bun:test'
import { createInkTestRenderer } from '../../tui/testing'
import React from 'react'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { Select } from './select'

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

const OPTIONS = [
  { label: 'First', value: 'first' },
  { label: 'Second', value: 'second' },
  { label: 'Third', value: 'third' },
]

describe('Select', () => {
  test('renders all options', async () => {
    const h = createInkTestRenderer({ width: 40, height: 8 })
    h.render(
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <Select options={OPTIONS} onChange={() => {}} />
          </ThemeProvider>
        </AppStateProvider>
      ,
    )

    const frame = await waitForFrame(
      h,
      f => f.includes('First') && f.includes('Second') && f.includes('Third'),
    )
    expect(frame).toContain('First')
    expect(frame).toContain('Second')
    expect(frame).toContain('Third')
  })

  // The default focus lands on the first option, shown by the ❯ indicator.
  // Full keyboard-driven navigation/selection rides the keybinding context,
  // which is wired by the REPL's keybinding setup (ported in a later task);
  // this asserts the focus state the select state machine produces on mount.
  test('focuses the first option by default', async () => {
    const h = createInkTestRenderer({ width: 40, height: 8 })
    h.render(
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <Select options={OPTIONS} onChange={() => {}} />
          </ThemeProvider>
        </AppStateProvider>
      ,
    )

    const frame = await waitForFrame(h, f => f.includes('First'))
    const firstLine = frame.split('\n')[0] ?? ''
    expect(firstLine).toContain('❯')
    expect(firstLine).toContain('First')
  })
})
