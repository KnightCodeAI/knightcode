import { describe, expect, test } from 'bun:test'
import { CommanderError } from 'commander'
import { parseCliArgs } from './parseArgs.js'

describe('parseCliArgs', () => {
  test('defaults with no args', () => {
    const o = parseCliArgs([])
    expect(o.print).toBe(false)
    expect(o.verbose).toBe(false)
    expect(o.bare).toBe(false)
    expect(o.dangerouslySkipPermissions).toBe(false)
    expect(o.disableSlashCommands).toBe(false)
    expect(o.strictMcpConfig).toBe(false)
    expect(o.addDir).toEqual([])
    expect(o.prompt).toBeUndefined()
    expect(o.model).toBeUndefined()
    expect(o.permissionMode).toBeUndefined()
  })

  test('captures a positional prompt', () => {
    expect(parseCliArgs(['do the thing']).prompt).toBe('do the thing')
  })

  test('boolean flags', () => {
    const o = parseCliArgs([
      '--print',
      '--verbose',
      '--bare',
      '--dangerously-skip-permissions',
      '--disable-slash-commands',
      '--strict-mcp-config',
    ])
    expect(o.print).toBe(true)
    expect(o.verbose).toBe(true)
    expect(o.bare).toBe(true)
    expect(o.dangerouslySkipPermissions).toBe(true)
    expect(o.disableSlashCommands).toBe(true)
    expect(o.strictMcpConfig).toBe(true)
  })

  test('value flags', () => {
    const o = parseCliArgs([
      '--model',
      'opus',
      '--system-prompt',
      'be terse',
      '--append-system-prompt',
      'also cite files',
      '--setting-sources',
      'user,project',
    ])
    expect(o.model).toBe('opus')
    expect(o.systemPrompt).toBe('be terse')
    expect(o.appendSystemPrompt).toBe('also cite files')
    expect(o.settingSources).toBe('user,project')
  })

  test('--add-dir collects multiple directories', () => {
    expect(parseCliArgs(['--add-dir', 'a', 'b', 'c']).addDir).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  test('--permission-mode accepts a valid mode', () => {
    expect(parseCliArgs(['--permission-mode', 'plan']).permissionMode).toBe(
      'plan',
    )
  })

  test('--permission-mode rejects an invalid mode', () => {
    expect(() => parseCliArgs(['--permission-mode', 'bogus'])).toThrow(
      CommanderError,
    )
  })

  test('-p short flag maps to print', () => {
    expect(parseCliArgs(['-p']).print).toBe(true)
  })

  test('--help throws (handled by the caller) rather than returning', () => {
    expect(() => parseCliArgs(['--help'])).toThrow(CommanderError)
  })

  test('--version throws with the provided version', () => {
    try {
      parseCliArgs(['--version'], '1.2.3')
      throw new Error('expected a throw')
    } catch (e) {
      expect(e).toBeInstanceOf(CommanderError)
    }
  })

  test('unknown flag throws', () => {
    expect(() => parseCliArgs(['--definitely-not-a-flag'])).toThrow(
      CommanderError,
    )
  })
})
