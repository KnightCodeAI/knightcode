import { describe, expect, test } from 'bun:test'
import { deepseekEnsureReasoning, mistralScrubToolIds } from './messages.js'

describe('deepseekEnsureReasoning', () => {
  test('adds an empty reasoning block to assistant array messages lacking one', () => {
    const out = deepseekEnsureReasoning([
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ])
    const parts = out[0].content
    expect(parts.some((p: any) => p.type === 'thinking' || p.type === 'reasoning')).toBe(true)
  })
})

describe('mistralScrubToolIds', () => {
  test('truncates tool_use ids to 9 alphanumeric chars', () => {
    const out = mistralScrubToolIds([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_ABC-123-xyz', name: 'x', input: {} }] },
    ])
    expect(out[0].content[0].id).toMatch(/^[a-zA-Z0-9]{9}$/)
  })
})
