import { describe, expect, test } from 'bun:test'
import { isCompletionSubcommand } from './completionCommand.js'
import {
  COMPLETION_SHELLS,
  generateCompletionScript,
  isCompletionShell,
} from './handlers/completion.js'

describe('isCompletionSubcommand', () => {
  test('true only when argv[2] is "completion"', () => {
    expect(isCompletionSubcommand(['node', 'cli', 'completion'])).toBe(true)
    expect(isCompletionSubcommand(['node', 'cli', 'completion', 'bash'])).toBe(
      true,
    )
    expect(isCompletionSubcommand(['node', 'cli', 'agents'])).toBe(false)
    expect(isCompletionSubcommand(['node', 'cli'])).toBe(false)
  })
})

describe('isCompletionShell', () => {
  test('accepts only bash/zsh/fish', () => {
    expect(isCompletionShell('bash')).toBe(true)
    expect(isCompletionShell('zsh')).toBe(true)
    expect(isCompletionShell('fish')).toBe(true)
    expect(isCompletionShell('powershell')).toBe(false)
    expect(isCompletionShell('')).toBe(false)
  })
})

describe('generateCompletionScript', () => {
  for (const shell of COMPLETION_SHELLS) {
    test(`${shell}: includes subcommands, key flags, and permission-mode choices`, () => {
      const script = generateCompletionScript(shell, '1.2.3')
      // Subcommands
      expect(script).toContain('mcp')
      expect(script).toContain('doctor')
      expect(script).toContain('agents')
      // Representative flags derived from buildProgram (bash/zsh render the
      // `--` form, fish the `-l name` form — assert the bare name either way).
      expect(script).toContain('model')
      expect(script).toContain('permission-mode')
      // Permission-mode choices are expanded
      expect(script).toContain('plan')
      // Binds to the knightcode binary
      expect(script).toContain('knightcode')
      expect(script.length).toBeGreaterThan(0)
    })
  }

  test('bash registers a complete -F handler', () => {
    const script = generateCompletionScript('bash', '1.2.3')
    expect(script).toContain('complete -F _knightcode_completions knightcode')
  })

  test('zsh starts with the #compdef directive', () => {
    const script = generateCompletionScript('zsh', '1.2.3')
    expect(script.startsWith('#compdef knightcode')).toBe(true)
  })

  test('fish uses complete -c knightcode lines', () => {
    const script = generateCompletionScript('fish', '1.2.3')
    expect(script).toContain('complete -c knightcode')
    expect(script).toContain('-n __fish_use_subcommand -a')
  })
})
