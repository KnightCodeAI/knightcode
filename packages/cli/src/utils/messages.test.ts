import { describe, expect, test } from 'bun:test'
import { NO_CONTENT_MESSAGE } from '../constants/messages.js'
import {
  createAssistantMessage,
  createUserMessage,
  deriveUUID,
  ensureToolResultPairing,
  mergeUserMessages,
  normalizeMessages,
  SYNTHETIC_MODEL,
  SYNTHETIC_TOOL_RESULT_PLACEHOLDER,
} from './messages.js'
import type { UUID } from 'crypto'

describe('createUserMessage', () => {
  test('fills uuid and timestamp', () => {
    const msg = createUserMessage({ content: 'hello' })
    expect(msg.type).toBe('user')
    expect(msg.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(Date.parse(msg.timestamp)).toBeGreaterThan(0)
    expect(msg.message).toEqual({ role: 'user', content: 'hello' })
  })

  test('never sends empty content', () => {
    const msg = createUserMessage({ content: '' })
    expect(msg.message.content).toBe(NO_CONTENT_MESSAGE)
  })
})

describe('createAssistantMessage', () => {
  test('wraps string content in a text block under the synthetic model', () => {
    const msg = createAssistantMessage({ content: 'hi there' })
    expect(msg.type).toBe('assistant')
    expect(msg.message.model).toBe(SYNTHETIC_MODEL)
    expect(msg.message.content).toEqual([
      { type: 'text', text: 'hi there' } as never,
    ])
  })

  test('substitutes the no-content placeholder for empty strings', () => {
    const msg = createAssistantMessage({ content: '' })
    expect(msg.message.content).toEqual([
      { type: 'text', text: NO_CONTENT_MESSAGE } as never,
    ])
  })
})

describe('normalizeMessages', () => {
  test('splits multi-block assistant messages with derived uuids', () => {
    const assistant = createAssistantMessage({
      content: [
        { type: 'text', text: 'one', citations: [] },
        { type: 'text', text: 'two', citations: [] },
      ],
    })
    const normalized = normalizeMessages([assistant])
    expect(normalized).toHaveLength(2)
    expect(normalized[0]!.uuid).toBe(deriveUUID(assistant.uuid, 0))
    expect(normalized[1]!.uuid).toBe(deriveUUID(assistant.uuid, 1))
  })

  test('string user content becomes a single text block', () => {
    const user = createUserMessage({ content: 'plain' })
    const normalized = normalizeMessages([user])
    expect(normalized).toHaveLength(1)
    const only = normalized[0]!
    if (only.type !== 'user') throw new Error('expected user message')
    expect(only.message.content).toEqual([{ type: 'text', text: 'plain' }])
    expect(only.uuid).toBe(user.uuid)
  })
})

describe('mergeUserMessages', () => {
  test('joins text and keeps the non-meta uuid', () => {
    const meta = createUserMessage({ content: 'context', isMeta: true })
    const real = createUserMessage({ content: 'question' })
    const merged = mergeUserMessages(meta, real)
    expect(merged.uuid).toBe(real.uuid)
    const content = merged.message.content
    expect(Array.isArray(content)).toBe(true)
  })
})

describe('ensureToolResultPairing', () => {
  test('inserts a synthetic tool_result for an unpaired tool_use', () => {
    const assistant = createAssistantMessage({
      content: [
        {
          type: 'tool_use',
          id: 'toolu_123',
          name: 'Bash',
          input: {},
        } as never,
      ],
    })
    const user = createUserMessage({ content: 'next turn' })
    const repaired = ensureToolResultPairing([assistant, user])
    // The following user message is patched in place: the synthetic
    // tool_result is prepended ahead of its original content.
    expect(repaired.length).toBe(2)
    const patched = repaired[1]!
    if (patched.type !== 'user') throw new Error('expected patched user')
    const blocks = patched.message.content
    if (typeof blocks === 'string') throw new Error('expected block array')
    expect(blocks[0]).toMatchObject({
      type: 'tool_result',
      tool_use_id: 'toolu_123',
      content: SYNTHETIC_TOOL_RESULT_PLACEHOLDER,
    })
    expect(blocks.some(b => b.type === 'text')).toBe(true)
  })

  test('strips orphaned tool_results', () => {
    const user = createUserMessage({
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_orphan',
          content: 'result',
        },
      ],
    })
    const repaired = ensureToolResultPairing([user])
    const only = repaired[0]
    if (!only) {
      // The whole message may be dropped when stripping leaves it empty.
      expect(repaired).toHaveLength(0)
      return
    }
    if (only.type !== 'user') throw new Error('expected user message')
    const content = only.message.content
    if (typeof content === 'string') return
    expect(content.some(b => b.type === 'tool_result')).toBe(false)
  })
})

describe('deriveUUID', () => {
  test('is deterministic and uuid-shaped', () => {
    const parent = '123e4567-e89b-12d3-a456-426614174000' as UUID
    expect(deriveUUID(parent, 1)).toBe(deriveUUID(parent, 1))
    expect(deriveUUID(parent, 1)).not.toBe(deriveUUID(parent, 2))
    expect(deriveUUID(parent, 1)).toHaveLength(36)
  })
})
