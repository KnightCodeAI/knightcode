import { describe, expect, test } from 'bun:test'
import init from './init.js'
import version from './version.js'

describe('init command', () => {
  test('is a builtin prompt command', () => {
    expect(init.name).toBe('init')
    expect(init.type).toBe('prompt')
    if (init.type === 'prompt') {
      expect(init.source).toBe('builtin')
      expect(init.progressMessage).toBe('analyzing your codebase')
    }
  })

  test('getPromptForCommand returns the CLAUDE.md setup prompt', async () => {
    if (init.type !== 'prompt') throw new Error('init must be a prompt command')
    const blocks = await init.getPromptForCommand()
    const text = blocks
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('\n')
    expect(text).toContain('CLAUDE.md')
  })
})

describe('version command', () => {
  test('is a local non-interactive command', () => {
    expect(version.name).toBe('version')
    expect(version.type).toBe('local')
    if (version.type === 'local') {
      expect(version.supportsNonInteractive).toBe(true)
    }
  })

  test('load().call() returns the build version text', async () => {
    if (version.type !== 'local') throw new Error('version must be local')
    const mod = await version.load()
    const result = await mod.call('', {} as never)
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value.length).toBeGreaterThan(0)
    }
  })
})
