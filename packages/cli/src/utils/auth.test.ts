import { test, expect, afterEach, beforeEach } from 'bun:test'
import {
  getKnightcodeApiKeyWithSource,
  clearApiKeyHelperCache,
} from './auth.js'

beforeEach(() => clearApiKeyHelperCache())
afterEach(() => {
  delete process.env.OPENROUTER_API_KEY
  clearApiKeyHelperCache()
})

test('env key resolves with source OPENROUTER_API_KEY', () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test'
  expect(getKnightcodeApiKeyWithSource().source).toBe('OPENROUTER_API_KEY')
})
