import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../../tui/components/App'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { MCPListPanel } from './MCPListPanel.js'
import type { ServerInfo } from './types.js'

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
    await new Promise(r => setTimeout(r, 10))
  }
  return frame
}

const server = {
  name: 'github',
  scope: 'user',
  transport: 'stdio',
  config: { type: 'stdio', command: 'mcp-github', scope: 'user' },
  client: {
    name: 'github',
    type: 'connected',
    config: { type: 'stdio', command: 'mcp-github', scope: 'user' },
    client: {},
    capabilities: { tools: {} },
  },
} as unknown as ServerInfo

describe('MCPListPanel', () => {
  test('renders a configured server by name', async () => {
    const h = await createTestRenderer({ width: 80, height: 20 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <MCPListPanel
              servers={[server]}
              onSelectServer={() => {}}
              onComplete={() => {}}
            />
          </ThemeProvider>
        </AppStateProvider>
      </TuiApp>,
    )
    const frame = await waitForFrame(h, f => f.includes('github'))
    expect(frame).toContain('github')
  })
})
