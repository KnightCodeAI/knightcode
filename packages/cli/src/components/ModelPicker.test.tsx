import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import * as React from 'react'
import TuiApp from '../tui/components/App'
import { AppStateProvider } from '../state/AppState'
import { getDefaultAppState } from '../state/AppStateStore'
import { ThemeProvider } from './design-system/ThemeProvider'
import { ModelPicker } from './ModelPicker'
import { getModelOptions } from '../utils/model/modelOptions'

// ModelPicker renders the configurable model shortlist through a Select. The
// option list is built by getModelOptions (covered directly below); the mount
// test asserts the picker composes over the renderer and paints a frame that
// includes a model label, without throwing.

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))

describe('getModelOptions', () => {
  test('returns the model shortlist with values and labels', () => {
    const options = getModelOptions()
    expect(options.length).toBeGreaterThan(0)
    // The default ("use the configured model") option carries a null value.
    expect(options.some(o => o.value === null)).toBe(true)
    // Every option has a renderable label.
    for (const option of options) {
      expect(typeof option.label).toBe('string')
      expect(option.label.length).toBeGreaterThan(0)
    }
    // The shortlist surfaces the core model aliases.
    const values = options.map(o => o.value)
    expect(values).toContain('opus')
    expect(values).toContain('haiku')
  })
})

describe('ModelPicker', () => {
  test('mounts and paints a frame with a model label', async () => {
    const selected: Array<string | null> = []
    const h = await createTestRenderer({ width: 80, height: 20 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <AppStateProvider initialState={getDefaultAppState()}>
          <ThemeProvider initialState="dark">
            <ModelPicker
              initial={null}
              onSelect={model => {
                selected.push(model)
              }}
            />
          </ThemeProvider>
        </AppStateProvider>
      </TuiApp>,
    )

    await h.renderOnce()
    await tick()
    await h.renderOnce()

    const frame = h.captureCharFrame()
    expect(typeof frame).toBe('string')
    // A model label from the shortlist is painted in the picker.
    expect(frame).toContain('Opus')
  })
})
