// packages/cli/src/utils/model/profile/index.test.ts
import { describe, expect, test } from 'bun:test'
import { applyExtraBody, resolveModelProfile } from './index.js'

describe('profile barrel', () => {
  test('re-exports resolveModelProfile', () => {
    expect(typeof resolveModelProfile).toBe('function')
  })
  test('applyExtraBody merges extraBody but not provider', () => {
    const profile = { ...resolveModelProfile('kimi/k2'), extraBody: { chat_template_args: { enable_thinking: true }, provider: { x: 1 } } }
    const out = applyExtraBody({}, profile as any)
    expect(out.chat_template_args).toEqual({ enable_thinking: true })
    expect('provider' in out).toBe(false)
  })
})
