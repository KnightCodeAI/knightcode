// Ink test renderer — the substrate's answer to `@opentui/core/testing`.
//
// Mounts a React tree through the Ink reconciler into an offscreen Screen
// buffer and lets tests read it back as plain text. Unlike `renderToScreen`
// (which unmounts after every call for the search side-render), this keeps the
// container mounted across `renderOnce()` calls so timer/effect-driven state
// (spinners, animations) advances between frames — matching how the OpenTUI
// test harness behaved.
//
// Rendered content is wrapped in the same context providers `App` supplies
// (terminal size, app exit, stdin, terminal focus, clock) so components that
// call useTerminalSize()/useApp()/useInput() render the way they do in the app.
//
// Usage:
//   const r = createInkTestRenderer({ width: 40 })
//   r.render(<ThemeProvider><MyComponent /></ThemeProvider>)
//   expect(r.captureCharFrame()).toContain('hello')
//   // advance an animation:
//   await tick(); r.renderOnce()
//   r.unmount()
import noop from 'lodash-es/noop.js'
import React, { type ReactElement, type ReactNode } from 'react'
import { LegacyRoot } from 'react-reconciler/constants.js'
import AppContext from './components/AppContext.js'
import { ClockProvider } from './components/ClockContext.js'
import StdinContext from './components/StdinContext.js'
import { TerminalFocusProvider } from './components/TerminalFocusContext.js'
import { TerminalSizeContext } from './components/TerminalSizeContext.js'
import { createNode } from './dom.js'
import { EventEmitter } from './events/emitter.js'
import { FocusManager } from './focus.js'
import Output from './output.js'
import reconciler from './reconciler.js'
import renderNodeToOutput, {
  resetLayoutShifted,
} from './render-node-to-output.js'
import {
  CharPool,
  cellAtIndex,
  createScreen,
  HyperlinkPool,
  type Screen,
  StylePool,
} from './screen.js'

export type InkTestRenderer = {
  /** Mount (or replace) the tree and paint a frame. */
  render(node: ReactNode): void
  /** Flush pending state updates (timers/effects) and repaint. */
  renderOnce(): void
  /** The most recent frame as newline-joined text (trailing blanks trimmed). */
  captureCharFrame(): string
  /** Tear down the container. */
  unmount(): void
  /** The stdin event emitter; emit 'input' InputEvents to drive useInput(). */
  readonly inputEmitter: EventEmitter
  /** Natural height (rows) of the last painted frame. */
  readonly height: number
}

export function createInkTestRenderer(
  opts: { width?: number; height?: number } = {},
): InkTestRenderer {
  const width = opts.width ?? 80
  const rows = opts.height ?? 24
  const inputEmitter = new EventEmitter()

  const root = createNode('ink-root')
  root.focusManager = new FocusManager(() => false)
  const stylePool = new StylePool()
  const charPool = new CharPool()
  const hyperlinkPool = new HyperlinkPool()
  const container = reconciler.createContainer(
    root,
    LegacyRoot,
    null,
    false,
    null,
    'ink-test',
    noop,
    noop,
    noop,
    noop,
  )

  let screen: Screen | undefined
  let height = 0

  function wrap(node: ReactNode): ReactElement {
    return (
      <TerminalSizeContext.Provider value={{ columns: width, rows }}>
        <AppContext.Provider value={{ exit: noop }}>
          <StdinContext.Provider
            value={{
              stdin: process.stdin,
              setRawMode: noop,
              isRawModeSupported: false,
              internal_exitOnCtrlC: false,
              internal_eventEmitter: inputEmitter,
              internal_querier: null,
            }}
          >
            <TerminalFocusProvider>
              <ClockProvider>{node}</ClockProvider>
            </TerminalFocusProvider>
          </StdinContext.Provider>
        </AppContext.Provider>
      </TerminalSizeContext.Provider>
    )
  }

  function paint(): void {
    root.yogaNode?.setWidth(width)
    root.yogaNode?.calculateLayout(width)
    height = Math.ceil(root.yogaNode?.getComputedHeight() ?? 0)
    const next = createScreen(
      width,
      Math.max(1, height),
      stylePool,
      charPool,
      hyperlinkPool,
    )
    const output = new Output({ width, height, stylePool, screen: next })
    resetLayoutShifted()
    renderNodeToOutput(root, output, { prevScreen: undefined })
    screen = output.get()
  }

  return {
    render(node) {
      reconciler.updateContainerSync(wrap(node), container, null, noop)
      reconciler.flushSyncWork()
      paint()
    },
    renderOnce() {
      reconciler.flushSyncWork()
      paint()
    },
    captureCharFrame() {
      if (!screen) return ''
      const lines: string[] = []
      for (let y = 0; y < screen.height; y++) {
        let line = ''
        for (let x = 0; x < screen.width; x++) {
          line += cellAtIndex(screen, y * screen.width + x).char || ' '
        }
        lines.push(line.replace(/\s+$/, ''))
      }
      return lines.join('\n').replace(/\n+$/, '')
    },
    unmount() {
      reconciler.updateContainerSync(null, container, null, noop)
      reconciler.flushSyncWork()
    },
    get inputEmitter() {
      return inputEmitter
    },
    get height() {
      return height
    },
  }
}
