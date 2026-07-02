import { afterEach, describe, expect, test } from 'bun:test'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { _resetStreamJsonStdoutGuardForTesting } from '../utils/streamJsonStdoutGuard.js'
import type { HeadlessTurnOptions } from './headlessQuery.js'
import { parseCliArgs } from './parseArgs.js'
import { runPrintMode } from './print.js'

// Guards against a stream-json test leaving process.stdout.write patched for
// later tests/files in the same process.
afterEach(() => {
  _resetStreamJsonStdoutGuardForTesting()
})

const initMsg: SDKMessage = { type: 'system', subtype: 'init', uuid: 'i1' }
const assistantMsg = {
  type: 'assistant',
  uuid: 'a1',
  message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
} as unknown as SDKMessage

function successResult(text = 'hello world'): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    num_turns: 1,
  }
}

function errorResult(): SDKMessage {
  return {
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: '',
    errors: ['boom'],
  }
}

// Stub turnFn — never touches the real query loop / network. Ignores opts
// entirely and just replays a canned message list.
function stubTurnFn(messages: SDKMessage[]): typeof import('./headlessQuery.js').runHeadlessTurn {
  return (async function* (_opts: HeadlessTurnOptions) {
    for (const m of messages) yield m
  }) as never
}

function makeIo(readStdin: () => Promise<string> = async () => '') {
  const out: string[] = []
  const err: string[] = []
  return {
    stdout: (s: string) => {
      out.push(s)
    },
    stderr: (s: string) => {
      err.push(s)
    },
    readStdin,
    out,
    err,
  }
}

describe('runPrintMode', () => {
  test('text mode prints result text and returns 0', async () => {
    const io = makeIo()
    const cli = parseCliArgs(['-p', 'hi'])

    const exitCode = await runPrintMode(cli, {
      stdout: io.stdout,
      stderr: io.stderr,
      readStdin: io.readStdin,
      turnFn: stubTurnFn([initMsg, assistantMsg, successResult('hello world')]),
    })

    expect(exitCode).toBe(0)
    expect(io.out.join('')).toBe('hello world\n')
    expect(io.err).toEqual([])
  })

  test('json mode prints single result JSON', async () => {
    const io = makeIo()
    const cli = parseCliArgs(['-p', 'hi', '--output-format', 'json'])
    const result = successResult('hello world')

    const exitCode = await runPrintMode(cli, {
      stdout: io.stdout,
      stderr: io.stderr,
      readStdin: io.readStdin,
      turnFn: stubTurnFn([initMsg, assistantMsg, result]),
    })

    expect(exitCode).toBe(0)
    expect(io.out.join('')).toBe(JSON.stringify(result) + '\n')
  })

  test('stream-json without verbose returns 1 with stderr message', async () => {
    const io = makeIo()
    const cli = parseCliArgs(['-p', 'hi', '--output-format', 'stream-json'])

    const exitCode = await runPrintMode(cli, {
      stdout: io.stdout,
      stderr: io.stderr,
      readStdin: io.readStdin,
      turnFn: stubTurnFn([initMsg, assistantMsg, successResult()]),
    })

    expect(exitCode).toBe(1)
    expect(io.out).toEqual([])
    expect(io.err.join('')).toContain('--output-format=stream-json requires --verbose')
  })

  test('stream-json+verbose emits one JSON line per message', async () => {
    const io = makeIo()
    const cli = parseCliArgs([
      '-p',
      'hi',
      '--output-format',
      'stream-json',
      '--verbose',
    ])
    const messages = [initMsg, assistantMsg, successResult()]

    const exitCode = await runPrintMode(cli, {
      stdout: io.stdout,
      stderr: io.stderr,
      readStdin: io.readStdin,
      turnFn: stubTurnFn(messages),
    })

    expect(exitCode).toBe(0)
    expect(io.out).toEqual(messages.map(m => JSON.stringify(m) + '\n'))
  })

  test('is_error result returns 1', async () => {
    const io = makeIo()
    const cli = parseCliArgs(['-p', 'hi'])

    const exitCode = await runPrintMode(cli, {
      stdout: io.stdout,
      stderr: io.stderr,
      readStdin: io.readStdin,
      turnFn: stubTurnFn([initMsg, errorResult()]),
    })

    expect(exitCode).toBe(1)
    expect(io.out.join('')).toBe('Execution error')
  })

  test('missing prompt (no positional, empty stdin) returns 1', async () => {
    const io = makeIo(async () => '')
    const cli = parseCliArgs(['-p'])

    const exitCode = await runPrintMode(cli, {
      stdout: io.stdout,
      stderr: io.stderr,
      readStdin: io.readStdin,
      turnFn: stubTurnFn([]),
    })

    expect(exitCode).toBe(1)
    expect(io.err.join('')).toContain(
      'Input must be provided either through stdin or as a prompt argument when using --print',
    )
  })

  test('stdin supplies the prompt when no positional arg is given', async () => {
    const io = makeIo(async () => 'from stdin\n')
    const cli = parseCliArgs(['-p'])

    const exitCode = await runPrintMode(cli, {
      stdout: io.stdout,
      stderr: io.stderr,
      readStdin: io.readStdin,
      turnFn: stubTurnFn([initMsg, successResult('ok')]),
    })

    expect(exitCode).toBe(0)
    expect(io.out.join('')).toBe('ok\n')
  })

  test('-c/--resume combined with -p is rejected', async () => {
    const io = makeIo()
    const cli = parseCliArgs(['-p', 'hi', '--continue'])

    const exitCode = await runPrintMode(cli, {
      stdout: io.stdout,
      stderr: io.stderr,
      readStdin: io.readStdin,
      turnFn: stubTurnFn([initMsg, successResult()]),
    })

    expect(exitCode).toBe(1)
    expect(io.err.join('')).toContain('--continue/--resume are not yet supported with --print')
  })

  test('error_max_turns prints the upstream-parity message', async () => {
    const io = makeIo()
    const cli = parseCliArgs(['-p', 'hi', '--max-turns', '3'])

    const exitCode = await runPrintMode(cli, {
      stdout: io.stdout,
      stderr: io.stderr,
      readStdin: io.readStdin,
      turnFn: stubTurnFn([
        initMsg,
        {
          type: 'result',
          subtype: 'error_max_turns',
          is_error: true,
          result: '',
        },
      ]),
    })

    expect(exitCode).toBe(1)
    expect(io.out.join('')).toBe('Error: Reached max turns (3)')
  })
})
