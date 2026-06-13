import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../../../tui/components/App'
import { AppStateProvider } from '../../../state/AppState'
import { ThemeProvider } from '../../design-system/ThemeProvider'
import { UserToolErrorMessage } from './UserToolErrorMessage'

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

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <AppStateProvider>
      <ThemeProvider initialState="dark">{children}</ThemeProvider>
    </AppStateProvider>
  )
}

describe('tool result renderer', () => {
  test('renders a tool error result through the fallback view', async () => {
    const h = await createTestRenderer({ width: 60, height: 8 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <Wrap>
          <UserToolErrorMessage
            progressMessagesForMessage={[]}
            tool={undefined}
            tools={[]}
            param={{
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              is_error: true,
              content: 'boom went the tool',
            }}
            verbose={false}
          />
        </Wrap>
      </TuiApp>,
    )
    const frame = await waitForFrame(h, f =>
      f.replace(/\s/g, '').includes('boomwentthetool'),
    )
    expect(frame.replace(/\s/g, '')).toContain('boomwentthetool')
  })
})
