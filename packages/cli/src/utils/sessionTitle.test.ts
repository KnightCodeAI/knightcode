import { describe, expect, test } from 'bun:test'
import type { Message } from '../types/message.js'
import { extractConversationText } from './sessionTitle.js'

function userMsg(text: string, extra: Record<string, unknown> = {}): Message {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    ...extra,
  } as unknown as Message
}

function assistantMsg(text: string): Message {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  } as unknown as Message
}

describe('extractConversationText', () => {
  test('joins human user + assistant text', () => {
    const out = extractConversationText([
      userMsg('Fix the login bug'),
      assistantMsg('Looking at auth.ts'),
    ])
    expect(out).toContain('Fix the login bug')
    expect(out).toContain('Looking at auth.ts')
  })

  test('skips meta and non-human messages', () => {
    const out = extractConversationText([
      userMsg('visible prose'),
      userMsg('meta breadcrumb', { isMeta: true }),
      userMsg('command output', { origin: { kind: 'task-notification' } }),
    ])
    expect(out).toContain('visible prose')
    expect(out).not.toContain('meta breadcrumb')
    expect(out).not.toContain('command output')
  })

  test('tail-slices to the most recent 1000 chars', () => {
    const long = 'x'.repeat(2000)
    const out = extractConversationText([userMsg(long)])
    expect(out.length).toBe(1000)
  })
})
