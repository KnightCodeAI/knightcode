import type { CliRenderer, KeyEvent, PasteEvent } from '@opentui/core'
import React, { useEffect, useMemo } from 'react'
import { EventEmitter } from '../events/emitter.js'
import { InputEvent } from '../events/input-event.js'
import type { ParsedKey } from '../parse-keypress.js'
import { TerminalWriteProvider } from '../useTerminalNotification.js'
import AppContext from './AppContext.js'
import { ClockProvider } from './ClockContext.js'
import StdinContext from './StdinContext.js'
import { TerminalFocusProvider } from './TerminalFocusContext.js'
import { TerminalSizeContext, type TerminalSize } from './TerminalSizeContext.js'

export type Props = {
  renderer: CliRenderer
  exit: (error?: Error) => void
  exitOnCtrlC: boolean
  children?: React.ReactNode
}

/**
 * OpenTUI parses stdin itself; its parsed key carries the same fields as
 * ours minus a couple of flags. Re-shape it so the InputEvent pipeline
 * (Key flags, input normalization) behaves exactly as before.
 */
function toParsedKey(key: KeyEvent): ParsedKey {
  return {
    kind: 'key',
    fn: /^f\d+$/.test(key.name ?? ''),
    name: key.name,
    ctrl: key.ctrl,
    meta: key.meta,
    shift: key.shift,
    option: key.option,
    super: key.super ?? false,
    sequence: key.sequence,
    raw: key.raw,
    code: key.code,
    isPasted: false,
  }
}

function pastedKey(text: string): ParsedKey {
  return {
    kind: 'key',
    fn: false,
    name: undefined,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    super: false,
    sequence: text,
    raw: text,
    isPasted: true,
  }
}

/**
 * Root provider mounted by render()/createRoot() around every app tree.
 * Bridges OpenTUI's renderer (keyboard, size, raw writes) into the
 * contexts the hooks (useInput, useApp, useStdin, ...) consume.
 */
export default function App({
  renderer,
  exit,
  exitOnCtrlC,
  children,
}: Props): React.ReactNode {
  const appValue = useMemo(() => ({ exit }), [exit])

  const stdinValue = useMemo(
    () => ({
      stdin: renderer.stdin,
      setRawMode: () => {
        // OpenTUI owns the stdin stream and keeps it in raw mode for the
        // lifetime of the renderer; per-hook toggling is unnecessary.
      },
      isRawModeSupported: renderer.stdin.isTTY === true,
      internal_exitOnCtrlC: exitOnCtrlC,
      internal_eventEmitter: new EventEmitter(),
      internal_querier: null,
    }),
    [renderer, exitOnCtrlC],
  )

  const [size, setSize] = React.useState<TerminalSize>(() => ({
    columns: renderer.terminalWidth,
    rows: renderer.terminalHeight,
  }))

  useEffect(() => {
    const emitter = stdinValue.internal_eventEmitter

    const onKeyPress = (key: KeyEvent) => {
      const event = new InputEvent(toParsedKey(key))
      if (event.input === 'c' && event.key.ctrl && exitOnCtrlC) {
        exit()
        return
      }
      emitter.emit('input', event)
    }

    const onPaste = (paste: PasteEvent) => {
      const text = Buffer.from(paste.bytes).toString('utf8')
      if (text.length === 0) return
      emitter.emit('input', new InputEvent(pastedKey(text)))
    }

    const onResize = (width: number, height: number) => {
      setSize({ columns: width, rows: height })
    }

    renderer.keyInput.on('keypress', onKeyPress)
    renderer.keyInput.on('paste', onPaste)
    renderer.on('resize', onResize)

    return () => {
      renderer.keyInput.off('keypress', onKeyPress)
      renderer.keyInput.off('paste', onPaste)
      renderer.off('resize', onResize)
    }
  }, [renderer, stdinValue, exit, exitOnCtrlC])

  const writeRaw = useMemo(
    () => (data: string) => {
      process.stdout.write(data)
    },
    [],
  )

  return (
    <AppContext.Provider value={appValue}>
      <StdinContext.Provider value={stdinValue}>
        <TerminalWriteProvider value={writeRaw}>
          <TerminalSizeContext.Provider value={size}>
            <TerminalFocusProvider>
              <ClockProvider>{children}</ClockProvider>
            </TerminalFocusProvider>
          </TerminalSizeContext.Provider>
        </TerminalWriteProvider>
      </StdinContext.Provider>
    </AppContext.Provider>
  )
}
