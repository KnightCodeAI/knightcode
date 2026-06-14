import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../../tui/components/App'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../../components/design-system/ThemeProvider'
import { SkillsMenu } from '../../components/skills/SkillsMenu'
import { renderToolResultMessage, renderToolUseMessage } from './UI'
import type { Command } from '../../commands'

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

describe('SkillTool UI', () => {
  test('renderToolUseMessage shows the invoked skill name', () => {
    expect(renderToolUseMessage({ skill: 'verify' }, { commands: [] })).toBe(
      'verify',
    )
  })

  test('renderToolResultMessage reports a loaded inline skill', async () => {
    const h = await createTestRenderer({ width: 60, height: 8 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            {renderToolResultMessage({
              success: true,
              commandName: 'verify',
              status: 'inline',
            })}
          </ThemeProvider>
        </AppStateProvider>
      </TuiApp>,
    )
    const frame = await waitForFrame(h, f => f.includes('Successfully loaded'))
    expect(frame).toContain('Successfully loaded')
  })
})

describe('SkillsMenu', () => {
  test('renders the skills dialog over a bundled skill command', async () => {
    const h = await createTestRenderer({ width: 70, height: 16 })
    const skill: Command = {
      type: 'prompt',
      name: 'verify',
      description: 'Verify a code change.',
      contentLength: 0,
      progressMessage: 'running',
      source: 'bundled',
      loadedFrom: 'bundled',
      userInvocable: true,
      async getPromptForCommand() {
        return [{ type: 'text', text: 'verify' }]
      },
    }
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <SkillsMenu onExit={() => {}} commands={[skill]} />
          </ThemeProvider>
        </AppStateProvider>
      </TuiApp>,
    )
    const frame = await waitForFrame(h, f => f.includes('Skills'))
    expect(frame).toContain('Skills')
  })
})
