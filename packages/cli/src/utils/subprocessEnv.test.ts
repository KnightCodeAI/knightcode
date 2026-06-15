import { test, expect, afterEach } from 'bun:test'
import { subprocessEnv } from './subprocessEnv.js'

afterEach(() => {
  delete process.env.KNIGHTCODE_SUBPROCESS_ENV_SCRUB
  delete process.env.OPENROUTER_API_KEY
})

test('OPENROUTER_API_KEY is scrubbed from child env when scrubbing is enabled', () => {
  process.env.KNIGHTCODE_SUBPROCESS_ENV_SCRUB = '1'
  process.env.OPENROUTER_API_KEY = 'sk-or-secret'
  const out = subprocessEnv()
  expect(out.OPENROUTER_API_KEY).toBeUndefined()
})

test('the parent env keeps OPENROUTER_API_KEY (only children are scrubbed)', () => {
  process.env.KNIGHTCODE_SUBPROCESS_ENV_SCRUB = '1'
  process.env.OPENROUTER_API_KEY = 'sk-or-secret'
  subprocessEnv()
  expect(process.env.OPENROUTER_API_KEY).toBe('sk-or-secret')
})
