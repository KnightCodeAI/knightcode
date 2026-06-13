import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { applyGrouping, type MessageWithoutProgress } from './groupToolUses'
import type {
  NormalizedAssistantMessage,
  NormalizedUserMessage,
} from '../types/message.js'

function userText(text: string, uuid: string): NormalizedUserMessage {
  return {
    type: 'user',
    uuid: uuid as UUID,
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  }
}

function assistantText(text: string, uuid: string): NormalizedAssistantMessage {
  return {
    type: 'assistant',
    uuid: uuid as UUID,
    timestamp: '2026-01-01T00:00:01.000Z',
    message: {
      id: `msg_${uuid}`,
      type: 'message',
      role: 'assistant',
      model: 'test',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null,
      },
      content: [{ type: 'text', text, citations: null }],
    },
  } as NormalizedAssistantMessage
}

describe('applyGrouping', () => {
  test('preserves a mixed message stream in order when nothing groups', () => {
    const messages: MessageWithoutProgress[] = [
      userText('first question', 'u1'),
      assistantText('an answer', 'a1'),
      userText('second question', 'u2'),
    ]
    const { messages: out } = applyGrouping(messages, [], false)
    expect(out.map(m => m.type)).toEqual(['user', 'assistant', 'user'])
  })
})
