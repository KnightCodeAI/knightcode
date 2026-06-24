import { describe, expect, test } from 'bun:test'
import { createInkTestRenderer } from '../../tui/testing'
import React from 'react'
import { Box, Text } from '../../tui'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../../components/design-system/ThemeProvider'
import {
  MCPConnectionManager,
  useMcpReconnect,
  useMcpToggleEnabled,
} from './MCPConnectionManager.js'

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

function Child(): React.ReactNode {
  const reconnect = useMcpReconnect()
  const toggle = useMcpToggleEnabled()
  const ok = typeof reconnect === 'function' && typeof toggle === 'function'
  return (
    <Box flexDirection="column">
      <Text>{ok ? 'mcp-context-ok' : 'mcp-context-missing'}</Text>
    </Box>
  )
}

describe('MCPConnectionManager', () => {
  test('provides the reconnect/toggle context to children with no servers configured', async () => {
    const h = createInkTestRenderer({ width: 60, height: 8 })
    h.render(
        <AppStateProvider>
          <ThemeProvider initialState="dark">
            <MCPConnectionManager
              dynamicMcpConfig={undefined}
              isStrictMcpConfig={false}
            >
              <Child />
            </MCPConnectionManager>
          </ThemeProvider>
        </AppStateProvider>
      ,
    )
    const frame = await waitForFrame(h, f => f.includes('mcp-context'))
    expect(frame).toContain('mcp-context-ok')
  })
})
