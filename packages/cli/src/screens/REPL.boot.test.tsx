import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../tui/components/App'
import { App } from '../components/App'
import { ThemeProvider } from '../components/design-system/ThemeProvider'
import { getDefaultAppState } from '../state/AppStateStore'
import { getEmptyToolPermissionContext } from '../Tool'
import { getTools } from '../tools'
import { REPL } from './REPL'

// The frame-parity boot gate: mount the real REPL (the same component main.tsx
// launches) over the renderer with an empty session and assert it composes and
// paints a frame without throwing. This is the first point the upstream UI is
// exercised end-to-end in a test.

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))

describe('REPL boot', () => {
  test('mounts the real REPL and paints a frame', async () => {
    const h = await createTestRenderer({ width: 80, height: 24 })
    const initialTools = [...getTools(getEmptyToolPermissionContext())]

    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <ThemeProvider initialState="dark">
          <App getFpsMetrics={() => undefined} initialState={getDefaultAppState()}>
            <REPL
              commands={[]}
              debug={false}
              initialTools={initialTools}
              thinkingConfig={{ type: 'disabled' }}
            />
          </App>
        </ThemeProvider>
      </TuiApp>,
    )

    await h.renderOnce()
    await tick()
    await h.renderOnce()

    // The REPL tree mounts and the renderer yields a frame string without throwing.
    expect(typeof h.captureCharFrame()).toBe('string')
  })
})
