import { afterEach, expect, test } from 'bun:test'
import {
  STDOUT_GUARD_MARKER,
  _resetStreamJsonStdoutGuardForTesting,
  installStreamJsonStdoutGuard,
} from './streamJsonStdoutGuard.js'
import { writeToStdout } from './process.js'

const REAL_WRITE = process.stdout.write
const REAL_STDERR_WRITE = process.stderr.write

afterEach(() => {
  _resetStreamJsonStdoutGuardForTesting()
  process.stdout.write = REAL_WRITE
  process.stderr.write = REAL_STDERR_WRITE
})

test('guard diverts non-JSON stdout lines to stderr, passes JSON and writeToStdout', () => {
  const out: string[] = []
  const err: string[] = []
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  // Capture before installing so the guard wraps our capture.
  process.stdout.write = ((s: string) => (out.push(String(s)), true)) as never
  process.stderr.write = ((s: string) => (err.push(String(s)), true)) as never
  try {
    installStreamJsonStdoutGuard()
    process.stdout.write('stray library banner\n')
    writeToStdout('{"type":"result"}\n')
    expect(out.join('')).toBe('{"type":"result"}\n')
    expect(err.join('')).toContain('stray library banner')
    expect(err.join('')).toContain(STDOUT_GUARD_MARKER)
  } finally {
    process.stdout.write = origOut as never
    process.stderr.write = origErr as never
  }
})

test('installing twice is a no-op', () => {
  const origOut = process.stdout.write.bind(process.stdout)
  try {
    installStreamJsonStdoutGuard()
    const wrapped = process.stdout.write
    installStreamJsonStdoutGuard()
    expect(process.stdout.write).toBe(wrapped)
  } finally {
    process.stdout.write = origOut as never
  }
})

test('empty lines are tolerated as valid NDJSON', () => {
  const out: string[] = []
  const err: string[] = []
  const origOut = process.stdout.write.bind(process.stdout)
  const origErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = ((s: string) => (out.push(String(s)), true)) as never
  process.stderr.write = ((s: string) => (err.push(String(s)), true)) as never
  try {
    installStreamJsonStdoutGuard()
    process.stdout.write('\n')
    expect(out.join('')).toBe('\n')
    expect(err.join('')).toBe('')
  } finally {
    process.stdout.write = origOut as never
    process.stderr.write = origErr as never
  }
})
