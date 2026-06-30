import { describe, expect, test } from 'bun:test'
import { deepseekEnsureReasoning, mistralScrubToolIds, normalizeMessagesForModel } from './messages.js'
import type { ModelProfile } from '../types.js'

describe('deepseekEnsureReasoning', () => {
  test('adds an empty reasoning block to assistant array messages lacking one', () => {
    const out = deepseekEnsureReasoning([
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ])
    const parts = out[0].content
    expect(parts.some((p: any) => p.type === 'thinking' || p.type === 'reasoning')).toBe(true)
  })

  test('string content: wraps text and appends reasoning block', () => {
    const out = deepseekEnsureReasoning([{ role: 'assistant', content: 'hello' }])
    const parts = out[0].content
    expect(Array.isArray(parts)).toBe(true)
    expect(parts.some((p: any) => p.type === 'text' && p.text === 'hello')).toBe(true)
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

  test('pairing: tool_use id and tool_result tool_use_id match after scrub', () => {
    const msgs = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_01AbCDEFGH', name: 'x', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_01AbCDEFGH', content: 'r' }],
      },
    ]
    const out = mistralScrubToolIds(msgs)
    const scrubbedUseId = out[0].content[0].id
    const scrubbedResultId = out[1].content[0].tool_use_id
    expect(scrubbedUseId).toMatch(/^[a-zA-Z0-9]{9}$/)
    expect(scrubbedUseId).toBe(scrubbedResultId)
  })

  test('collision: distinct ids remain distinct after scrub', () => {
    const msgs = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_01AbCDEFGH', name: 'x', input: {} }],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_01AbIJKLMN', name: 'y', input: {} }],
      },
    ]
    const out = mistralScrubToolIds(msgs)
    const id1 = out[0].content[0].id
    const id2 = out[1].content[0].id
    expect(id1).not.toBe(id2)
  })
})

describe('normalizeMessagesForModel', () => {
  test('returns original messages unchanged when a transform throws', () => {
    const msgs = [{ role: 'user', content: 'hi' }]
    const profile: ModelProfile = {
      id: 'x',
      supportsReasoning: false,
      supportsTools: true,
      supportedParameters: new Set(),
      sampling: {},
      reasoning: { kind: 'none' },
      extraBody: {},
      schemaTransforms: [],
      messageTransforms: [() => { throw new Error('boom') }],
    }
    const result = normalizeMessagesForModel(msgs, profile)
    expect(result).toBe(msgs)
  })
})
