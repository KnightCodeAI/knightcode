import { describe, expect, test } from 'bun:test'
import React from 'react'
import Box from './components/Box'
import StdinContext from './components/StdinContext'
import Text from './components/Text'
import { EventEmitter } from './events/emitter'
import { InputEvent, type Key } from './events/input-event'
import useInput from './hooks/use-input'
import type { ParsedKey } from './parse-keypress'
import { createInkTestRenderer } from './testing'

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))

type Harness = ReturnType<typeof createInkTestRenderer>

/** Re-renders until the frame satisfies the predicate (timing-robust under load). */
async function waitForFrame(
  h: Harness,
  predicate: (frame: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let frame = ''
  while (Date.now() < deadline) {
    h.renderOnce()
    frame = h.captureCharFrame()
    if (predicate(frame)) return frame
    await tick()
  }
  throw new Error(`frame never satisfied predicate; last frame:\n${frame}`)
}

/** Mount `node` inside a StdinContext so useInput() has an emitter to listen on.
 *  Returns the emitter so tests can inject key events the way App's stdin
 *  handler would (it parses keypresses and emits 'input' on this emitter). */
function mount(h: Harness, node: React.ReactNode): EventEmitter {
  const emitter = new EventEmitter()
  h.render(
    <StdinContext.Provider
      value={{
        stdin: process.stdin,
        setRawMode: () => {},
        isRawModeSupported: false,
        internal_exitOnCtrlC: false,
        internal_eventEmitter: emitter,
        internal_querier: null,
      }}
    >
      {node}
    </StdinContext.Provider>,
  )
  return emitter
}

/** A parsed down-arrow keypress wrapped in an InputEvent, as App would emit. */
function downArrowEvent(): InputEvent {
  const keypress: ParsedKey = {
    kind: 'key',
    fn: false,
    name: 'down',
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: '\x1b[B',
    raw: '\x1b[B',
    isPasted: false,
  }
  return new InputEvent(keypress)
}

describe('tui rendering over ink', () => {
  test('Box lays out children in a row with a border', async () => {
    const h = createInkTestRenderer({ width: 40, height: 8 })
    mount(
      h,
      <Box flexDirection="row" borderStyle="round" gap={1}>
        <Text>left</Text>
        <Text>right</Text>
      </Box>,
    )

    const frame = await waitForFrame(h, f => f.includes('left'))
    expect(frame).toContain('right')
    expect(frame).toContain('╭')
    // Row layout: both words on the same line.
    const line = frame.split('\n').find(l => l.includes('left'))
    expect(line).toContain('right')

    h.unmount()
  })

  test('Text styles render without throwing and content survives', async () => {
    const h = createInkTestRenderer({ width: 40, height: 6 })
    mount(
      h,
      <Box flexDirection="column">
        <Text bold color="ansi:green">
          ok
        </Text>
        <Text dim>
          dim <Text underline>nested</Text>
        </Text>
      </Box>,
    )

    const frame = await waitForFrame(h, f => f.includes('ok'))
    expect(frame).toContain('dim')
    expect(frame).toContain('nested')

    h.unmount()
  })

  test('useInput receives a mapped Key object for an arrow key', async () => {
    const h = createInkTestRenderer({ width: 40, height: 4 })
    let recorded: { input: string; key: Key } | null = null

    function Probe() {
      useInput((input, key) => {
        recorded = { input, key }
      })
      return <Text>probe</Text>
    }
    const emitter = mount(h, <Probe />)
    await waitForFrame(h, f => f.includes('probe'))

    // The keyboard subscription mounts in a passive effect; retry until
    // the handler records the press.
    for (let attempt = 0; attempt < 20 && !recorded; attempt++) {
      emitter.emit('input', downArrowEvent())
      h.renderOnce()
      await tick()
    }

    expect(recorded).not.toBeNull()
    expect(recorded!.key.downArrow).toBe(true)
    expect(recorded!.input).toBe('')

    h.unmount()
  })
})
