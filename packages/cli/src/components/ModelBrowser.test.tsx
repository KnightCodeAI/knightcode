import { describe, expect, test } from 'bun:test'
import { createInkTestRenderer } from '../tui/testing'
import * as React from 'react'
import { AppStateProvider } from '../state/AppState'
import { getDefaultAppState } from '../state/AppStateStore'
import { ThemeProvider } from './design-system/ThemeProvider'
import { ModelBrowser } from './ModelBrowser'

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))

describe('ModelBrowser', () => {
  test('mounts and renders correctly', async () => {
    const selected: Array<string | null> = []
    const h = createInkTestRenderer({ width: 80, height: 20 })
    h.render(
        <AppStateProvider initialState={getDefaultAppState()}>
          <ThemeProvider initialState="dark">
            <ModelBrowser
              initial={null}
              onSelect={model => {
                selected.push(model)
              }}
            />
          </ThemeProvider>
        </AppStateProvider>
      ,
    )

    await h.renderOnce()
    await tick()
    await h.renderOnce()

    const frame = h.captureCharFrame()
    expect(typeof frame).toBe('string')
    expect(frame).toContain('OpenRouter')
  })
})
