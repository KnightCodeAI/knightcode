import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import { getSessionId } from 'src/bootstrap/state.js'
import { getTotalCost } from 'src/cost-tracker.js'
import type { Message } from 'src/types/message.js'
import {
  accumulateSdkUsage,
  buildResultMessage,
  EMPTY_SDK_USAGE,
  toSdkEnvelope,
  type Usage,
} from './sdkEnvelopes.js'

function makeAssistantMessage(): Message {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'hi there' }],
    },
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  } as Message
}

function makeUserMessage(): Message {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: 'hello',
    },
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  } as Message
}

describe('toSdkEnvelope', () => {
  test('wraps an assistant message with the SDK wire fields', () => {
    const msg = makeAssistantMessage()
    const envelope = toSdkEnvelope(msg)

    expect(envelope).not.toBeNull()
    expect(envelope?.type).toBe('assistant')
    expect(envelope?.message).toBe(
      (msg as unknown as { message: { content?: unknown } }).message,
    )
    expect(envelope?.session_id).toBe(getSessionId())
    expect(envelope?.parent_tool_use_id).toBeNull()
    expect(envelope?.uuid).toBe(msg.uuid)
    expect(envelope?.timestamp).toBe(
      (msg as unknown as { timestamp: string }).timestamp,
    )
  })

  test('wraps a user message with the SDK wire fields', () => {
    const msg = makeUserMessage()
    const envelope = toSdkEnvelope(msg)

    expect(envelope).not.toBeNull()
    expect(envelope?.type).toBe('user')
    expect(envelope?.message).toBe(
      (msg as unknown as { message: { content?: unknown } }).message,
    )
    expect(envelope?.session_id).toBe(getSessionId())
    expect(envelope?.parent_tool_use_id).toBeNull()
    expect(envelope?.uuid).toBe(msg.uuid)
    expect(envelope?.timestamp).toBe(
      (msg as unknown as { timestamp: string }).timestamp,
    )
  })

  test.each(['progress', 'attachment', 'system'] as const)(
    'returns null for %s messages',
    type => {
      const msg = {
        type,
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
      } as unknown as Message
      expect(toSdkEnvelope(msg)).toBeNull()
    },
  )
})

describe('buildResultMessage', () => {
  const usage: Usage = {
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 10,
    cache_read_input_tokens: 20,
  }

  test('builds a success result envelope', () => {
    const startTime = Date.now() - 500
    const result = buildResultMessage({
      subtype: 'success',
      startTime,
      numTurns: 4,
      resultText: 'the final answer',
      usage,
      stopReason: null,
    })

    expect(result.type).toBe('result')
    expect(result.subtype).toBe('success')
    expect(result.is_error).toBe(false)
    expect(result.num_turns).toBe(4)
    expect(result.result).toBe('the final answer')
    expect(result.stop_reason).toBeNull()
    expect(result.session_id).toBe(getSessionId())
    expect(result.total_cost_usd).toBe(getTotalCost())
    expect(result.usage).toEqual(usage)
    expect(result.modelUsage).toEqual({})
    expect(result.permission_denials).toEqual([])
    expect(typeof result.uuid).toBe('string')
    expect(result.duration_ms as number).toBeGreaterThanOrEqual(500)
    expect(result.errors).toBeUndefined()
  })

  test('builds an error_max_turns result envelope with errors passthrough', () => {
    const result = buildResultMessage({
      subtype: 'error_max_turns',
      startTime: Date.now(),
      numTurns: 10,
      resultText: '',
      usage: EMPTY_SDK_USAGE,
      stopReason: 'max_turns',
      errors: ['exceeded max turns'],
    })

    expect(result.subtype).toBe('error_max_turns')
    expect(result.is_error).toBe(true)
    expect(result.stop_reason).toBe('max_turns')
    expect(result.errors).toEqual(['exceeded max turns'])
  })

  test('builds an error_during_execution result envelope', () => {
    const result = buildResultMessage({
      subtype: 'error_during_execution',
      startTime: Date.now(),
      numTurns: 1,
      resultText: '',
      usage: EMPTY_SDK_USAGE,
      stopReason: null,
    })

    expect(result.is_error).toBe(true)
    expect(result.errors).toBeUndefined()
  })
})

describe('usage accumulation', () => {
  test('EMPTY_SDK_USAGE has zeroed fields', () => {
    expect(EMPTY_SDK_USAGE).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    })
  })

  test('accumulateSdkUsage adds fields element-wise', () => {
    const a: Usage = {
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: 3,
      cache_read_input_tokens: 4,
    }
    const b: Usage = {
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_input_tokens: 30,
      cache_read_input_tokens: 40,
    }
    expect(accumulateSdkUsage(a, b)).toEqual({
      input_tokens: 11,
      output_tokens: 22,
      cache_creation_input_tokens: 33,
      cache_read_input_tokens: 44,
    })
  })

  test('EMPTY_SDK_USAGE is the additive identity', () => {
    const a: Usage = {
      input_tokens: 5,
      output_tokens: 6,
      cache_creation_input_tokens: 7,
      cache_read_input_tokens: 8,
    }
    expect(accumulateSdkUsage(a, EMPTY_SDK_USAGE)).toEqual(a)
  })
})
