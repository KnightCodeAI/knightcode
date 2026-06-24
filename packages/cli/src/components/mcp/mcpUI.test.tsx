import { describe, expect, test } from 'bun:test'
import { createInkTestRenderer } from '../../tui/testing'
import React from 'react'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { MCPListPanel } from './MCPListPanel.js'
import type { ServerInfo } from './types.js'

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
    const h = createInkTestRenderer({ width: 80, height: 20 })
    h.render(
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <MCPListPanel
              servers={[server]}
              onSelectServer={() => {}}
              onComplete={() => {}}
            />
          </ThemeProvider>
        </AppStateProvider>
      ,
    )
    const frame = await waitForFrame(h, f => f.includes('github'))
    expect(frame).toContain('github')
  })
})
