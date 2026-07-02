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

  test('resume defaults', () => {
    const o = parseCliArgs([])
    expect(o.continueSession).toBe(false)
    expect(o.forkSession).toBe(false)
    expect(o.resume).toBeUndefined()
  })

  test('-c / --continue maps to continueSession', () => {
    expect(parseCliArgs(['-c']).continueSession).toBe(true)
    expect(parseCliArgs(['--continue']).continueSession).toBe(true)
  })

  test('--fork-session is a boolean', () => {
    expect(parseCliArgs(['--fork-session']).forkSession).toBe(true)
  })

  test('bare --resume / -r resolves to true (interactive picker)', () => {
    expect(parseCliArgs(['--resume']).resume).toBe(true)
    expect(parseCliArgs(['-r']).resume).toBe(true)
  })

  test('--resume with a value carries the session id / search term', () => {
    expect(parseCliArgs(['--resume', 'abc-123']).resume).toBe('abc-123')
    expect(parseCliArgs(['-r', 'my title']).resume).toBe('my title')
  })

  test('--continue and --fork-session combine', () => {
    const o = parseCliArgs(['--continue', '--fork-session'])
    expect(o.continueSession).toBe(true)
    expect(o.forkSession).toBe(true)
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

describe('headless flags', () => {
  test('--output-format parses and validates choices', () => {
    expect(parseCliArgs(['-p', 'hi', '--output-format', 'json']).outputFormat).toBe('json')
    expect(parseCliArgs(['-p', 'hi']).outputFormat).toBeUndefined()
    expect(() => parseCliArgs(['-p', 'hi', '--output-format', 'yaml'])).toThrow()
  })
  test('--max-turns parses as a number', () => {
    expect(parseCliArgs(['-p', 'hi', '--max-turns', '3']).maxTurns).toBe(3)
    expect(parseCliArgs(['-p', 'hi']).maxTurns).toBeUndefined()
  })
  test('--allowedTools / --disallowedTools accept space- and comma-separated values', () => {
    const o = parseCliArgs(['-p', 'hi', '--allowedTools', 'Bash(git:*)', 'Edit', '--disallowedTools', 'WebSearch,WebFetch'])
    expect(o.allowedTools).toEqual(['Bash(git:*)', 'Edit'])
    expect(o.disallowedTools).toEqual(['WebSearch', 'WebFetch'])
  })
  test('defaults are empty arrays', () => {
    const o = parseCliArgs(['-p', 'hi'])
    expect(o.allowedTools).toEqual([])
    expect(o.disallowedTools).toEqual([])
  })
  test('--max-turns with a non-numeric value is silently treated as unset', () => {
    expect(parseCliArgs(['-p', 'hi', '--max-turns', 'abc']).maxTurns).toBeUndefined()
  })
})
