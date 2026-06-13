import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { createRoot } from '@opentui/react'
import React from 'react'
import TuiApp from '../../tui/components/App'
import { AppStateProvider } from '../../state/AppState'
import { ThemeProvider } from '../design-system/ThemeProvider'
import { AssistantTextMessage } from './AssistantTextMessage'
import { UserTextMessage } from './UserTextMessage'

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

describe('message renderers', () => {
  test('AssistantTextMessage renders the assistant text', async () => {
    const h = await createTestRenderer({ width: 50, height: 6 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <Wrap>
          <AssistantTextMessage
            param={{ type: 'text', text: 'assistant reply here' }}
            addMargin={false}
            shouldShowDot={false}
            verbose={false}
          />
        </Wrap>
      </TuiApp>,
    )
    const frame = await waitForFrame(h, f =>
      f.replace(/\s/g, '').includes('assistantreplyhere'),
    )
    expect(frame.replace(/\s/g, '')).toContain('assistantreplyhere')
  })

  test('UserTextMessage renders the user text', async () => {
    const h = await createTestRenderer({ width: 50, height: 6 })
    createRoot(h.renderer).render(
      <TuiApp renderer={h.renderer} exit={() => {}} exitOnCtrlC={false}>
        <Wrap>
          <UserTextMessage
            param={{ type: 'text', text: 'a user question' }}
            addMargin={false}
            verbose={false}
          />
        </Wrap>
      </TuiApp>,
    )
    const frame = await waitForFrame(h, f =>
      f.replace(/\s/g, '').includes('auserquestion'),
    )
    expect(frame.replace(/\s/g, '')).toContain('auserquestion')
  })
})
