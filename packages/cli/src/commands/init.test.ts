import { test, expect } from 'bun:test'
import command from './init.js'

test('/init instructs creating KNIGHTCODE.md, not CLAUDE.md', async () => {
  const parts = await command.getPromptForCommand!()
  const text = parts.map(p => (p as { text?: string }).text ?? '').join('\n')
  expect(text).toContain('KNIGHTCODE.md')
  expect(text).not.toContain('CLAUDE.md')
  expect(text.toLowerCase()).not.toContain('claude code')
})
