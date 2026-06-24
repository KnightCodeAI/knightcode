import { describe, expect, test } from 'bun:test'
import { createInkTestRenderer } from '../tui/testing'
import React from 'react'
import { App } from '../components/App'
import { ThemeProvider } from '../components/design-system/ThemeProvider'
import { getDefaultAppState } from '../state/AppStateStore'
import { getEmptyToolPermissionContext } from '../Tool'
import { getTools } from '../tools'
import { clearCommandsCache, getCommands } from '../commands'
import { initBundledSkills } from '../skills/bundled/index'
import { REPL } from './REPL'

// End-to-end gate for P5: register bundled skills, build the real slash-command
// registry, and confirm it both contains the expected surface and drives the
// real REPL without throwing — the same wiring main.tsx performs at boot.

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))

describe('REPL with the real command registry', () => {
  test('the registry surfaces core commands + bundled skills and hides out-of-scope ones', async () => {
    initBundledSkills()
    clearCommandsCache()
    const commands = await getCommands(process.cwd())
    const names = new Set(commands.map(c => c.name))

    // Core slash commands.
    expect(names.has('help')).toBe(true)
    expect(names.has('model')).toBe(true)
    expect(names.has('hooks')).toBe(true)
    // A bundled skill (model-invocable).
    expect(names.has('simplify')).toBe(true)
    // Out-of-scope commands are filtered out.
    expect(names.has('login')).toBe(false)
    expect(names.has('teleport')).toBe(false)
  })

  test('the REPL mounts over the populated registry and paints a frame', async () => {
    initBundledSkills()
    clearCommandsCache()
    const commands = await getCommands(process.cwd())
    const h = createInkTestRenderer({ width: 80, height: 24 })
    const initialTools = [...getTools(getEmptyToolPermissionContext())]

    h.render(
        <ThemeProvider initialState="dark">
          <App
            getFpsMetrics={() => undefined}
            initialState={getDefaultAppState()}
          >
            <REPL
              commands={commands}
              debug={false}
              initialTools={initialTools}
              thinkingConfig={{ type: 'disabled' }}
            />
          </App>
        </ThemeProvider>
      ,
    )

    await h.renderOnce()
    await tick()
    await h.renderOnce()

    expect(typeof h.captureCharFrame()).toBe('string')
  })
})
