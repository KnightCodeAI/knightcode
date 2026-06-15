import { test, expect, afterEach } from 'bun:test'
import { getAnthropicApiKeyWithSource } from './auth.js'

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY
})

test('env key resolves with source OPENROUTER_API_KEY', () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test'
  expect(getAnthropicApiKeyWithSource().source).toBe('OPENROUTER_API_KEY')
})
