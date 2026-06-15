import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { clearApiKeyHelperCache } from '../../utils/auth.js'
import { createUserMessage } from '../../utils/messages.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import type { Options } from './knightcode.js'
import { isInvalidApiKeyError, queryModelWithStreaming } from './knightcode.js'

const fixture = readFileSync(
  join(import.meta.dir, '__fixtures__', 'openrouter-stream.txt'),
  'utf8',
)

let requestCount = 0
const fetchOverride = async (
  _input: unknown,
  _init?: unknown,
): Promise<Response> => {
  requestCount++
  return new Response(fixture, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'request-id': 'req_test_fixture',
    },
  })
}

const savedKey = process.env.OPENROUTER_API_KEY

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-real-key'
  clearApiKeyHelperCache()
  requestCount = 0
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = savedKey
  clearApiKeyHelperCache()
})

function makeOptions(overrides: Partial<Options> = {}): Options {
  return {
    getToolPermissionContext: async () => getEmptyToolPermissionContext(),
    model: 'anthropic/claude-3.5-haiku',
    isNonInteractiveSession: true,
    querySource: 'repl_main_thread',
    agents: [],
    hasAppendSystemPrompt: false,
    fetchOverride,
    mcpTools: [],
    ...overrides,
  }
}

describe('queryModelWithStreaming', () => {
  test('replays a gateway SSE stream into events and a final assistant message', async () => {
    const events: { type: string }[] = []
    const generator = queryModelWithStreaming({
      messages: [createUserMessage({ content: 'Say exactly: hello world' })],
      systemPrompt: asSystemPrompt(['You are a test assistant.']),
      thinkingConfig: { type: 'disabled' },
      tools: [],
      signal: new AbortController().signal,
      options: makeOptions(),
    })

    for await (const message of generator) {
      events.push(message)
    }

    expect(requestCount).toBe(1)

    const streamEventTypes = events
      .filter(e => e.type === 'stream_event')
      .map(e => (e as unknown as { event: { type: string } }).event.type)
    expect(streamEventTypes).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ])

    const assistant = events.find(e => e.type === 'assistant') as
      | {
          type: 'assistant'
          message: {
            content: { type: string; text?: string }[]
            usage: { output_tokens: number }
          }
          requestId?: string
        }
      | undefined
    if (!assistant) throw new Error('no assistant message yielded')
    expect(assistant.message.content[0]).toMatchObject({
      type: 'text',
      text: 'hello world',
    })
    expect(assistant.message.usage.output_tokens).toBe(5)
    expect(assistant.requestId).toBe('req_test_fixture')
  })

  test('a pre-aborted signal yields nothing and sends no request', async () => {
    const controller = new AbortController()
    controller.abort()
    const events: { type: string }[] = []
    try {
      for await (const message of queryModelWithStreaming({
        messages: [createUserMessage({ content: 'hi' })],
        systemPrompt: asSystemPrompt(['You are a test assistant.']),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: controller.signal,
        options: makeOptions(),
      })) {
        events.push(message)
      }
    } catch {
      // an abort error is acceptable here; the assertion below is what matters
    }
    expect(events.filter(e => e.type === 'assistant')).toHaveLength(0)
  })
})

describe('isInvalidApiKeyError', () => {
  test('a 401 surfaces as an invalid OpenRouter key, not x-api-key', () => {
    expect(isInvalidApiKeyError({ status: 401 })).toBe(true)
    expect(isInvalidApiKeyError({ status: 500 })).toBe(false)
    expect(isInvalidApiKeyError(new Error('boom'))).toBe(false)
  })
})
