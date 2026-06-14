import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../../tui/components/App'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { Text } from '../../tui'
import { PermissionDialog } from './PermissionDialog'
import { extractRules, hasRules } from '../../utils/permissions/PermissionUpdate'

// The full <PermissionRequest> dispatch (per-tool requests + the option-list
// prompt + rule-suggestion UI) pulls the whole tool registry and the sandbox
// adapter at module load, none of which is wired until the launcher (Task 14).
// Here we render the permission dialog frame — the user's trust surface — and
// cover the rule-extraction logic the dialog's "always allow" options build on.

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

describe('PermissionDialog', () => {
  test('renders the request title and body', async () => {
    const h = await createTestRenderer({ width: 60, height: 10 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <PermissionDialog
              title="Bash command"
              subtitle="rm -rf build"
            >
              <Text>Do you want to proceed?</Text>
            </PermissionDialog>
          </ThemeProvider>
        </AppStateProvider>
      </TuiApp>,
    )

    const frame = await waitForFrame(
      h,
      f => f.includes('Bash command') && f.includes('Do you want to proceed?'),
    )
    expect(frame).toContain('Bash command')
    expect(frame).toContain('rm -rf build')
    expect(frame).toContain('Do you want to proceed?')
  })
})

describe('extractRules / hasRules', () => {
  const rule = { toolName: 'Bash', ruleContent: 'git *' }

  test('extractRules flattens rule values from addRules updates', () => {
    const rules = extractRules([
      { type: 'addRules', rules: [rule], behavior: 'allow', destination: 'projectSettings' },
    ])
    expect(rules).toEqual([rule])
  })

  test('hasRules is true only when there are rules', () => {
    expect(hasRules(undefined)).toBe(false)
    expect(hasRules([])).toBe(false)
    expect(
      hasRules([
        { type: 'addRules', rules: [rule], behavior: 'allow', destination: 'projectSettings' },
      ]),
    ).toBe(true)
  })
})
