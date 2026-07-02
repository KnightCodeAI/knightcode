import { describe, expect, test } from 'bun:test'
import type { SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import { runHeadlessTurn } from './headlessQuery.js'

// A stubbed queryFn keeps these tests network-free: runHeadlessTurn never
// reaches the real agentic loop, so we exercise only the envelope framing
// (init → per-message envelopes → result) around whatever the loop yields.

async function* assistantThenSuccess() {
  yield {
    type: 'assistant',
    uuid: 'a1',
    timestamp: 't',
    message: { role: 'assistant', content: [{ type: 'text', text: 'hello world' }] },
  } as never
  return { type: 'success' } as never
}

async function* hitsMaxTurns() {
  yield {
    type: 'attachment',
    uuid: 'x1',
    timestamp: 't',
    attachment: { type: 'max_turns_reached', maxTurns: 3, turnCount: 4 },
  } as never
  return { type: 'success' } as never
}

async function* throwsMidTurn() {
  throw new Error('boom')
  // eslint-disable-next-line no-unreachable
  yield undefined as never
}

// Usage/stop_reason accumulation across a tool-call turn, then a final
// text-only assistant message: assistant(text) -> user(tool result) ->
// stream_event message_start/message_delta/message_stop -> assistant(text).
async function* usageAndFinalTextTurn() {
  yield {
    type: 'assistant',
    uuid: 'a1',
    timestamp: 't',
    message: { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
  } as never
  yield {
    type: 'user',
    uuid: 'u1',
    timestamp: 't',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }],
    },
  } as never
  yield {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        usage: {
          input_tokens: 10,
          output_tokens: 0,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
        },
      },
    },
  } as never
  yield {
    type: 'stream_event',
    event: {
      type: 'message_delta',
      usage: { output_tokens: 7 },
      delta: { stop_reason: 'end_turn' },
    },
  } as never
  yield {
    type: 'stream_event',
    event: { type: 'message_stop' },
  } as never
  yield {
    type: 'assistant',
    uuid: 'a2',
    timestamp: 't',
    message: { role: 'assistant', content: [{ type: 'text', text: 'final' }] },
  } as never
  return { type: 'success' } as never
}

// Final assistant message ends in a tool_use block (no trailing text).
async function* endsInToolUse() {
  yield {
    type: 'assistant',
    uuid: 'a1',
    timestamp: 't',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'thinking about it' },
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: {} },
      ],
    },
  } as never
  return { type: 'success' } as never
}

const baseOpts = {
  cwd: process.cwd(),
  dangerouslySkipPermissions: true,
  allowedTools: [] as string[],
  disallowedTools: [] as string[],
  verbose: false,
  // Avoid writing live session-storage files on every test run.
  recordTranscriptFn: async () => null,
}

async function drain(gen: AsyncGenerator<SDKMessage>): Promise<SDKMessage[]> {
  const out: SDKMessage[] = []
  for await (const m of gen) out.push(m)
  return out
}

describe('runHeadlessTurn', () => {
  test('yields init, assistant envelope, then success result with the assistant text', async () => {
    const out = await drain(
      runHeadlessTurn({
        ...baseOpts,
        prompt: 'hi',
        queryFn: assistantThenSuccess as never,
      }),
    )

    expect(out[0]?.type).toBe('system')
    expect((out[0] as Record<string, unknown>).subtype).toBe('init')
    expect(out[1]?.type).toBe('assistant')

    const result = out.at(-1) as Record<string, unknown>
    expect(result.type).toBe('result')
    expect(result.subtype).toBe('success')
    expect(result.is_error).toBe(false)
    expect(result.result).toBe('hello world')
  })

  test('max_turns_reached attachment yields an error_max_turns result and stops', async () => {
    const out = await drain(
      runHeadlessTurn({
        ...baseOpts,
        prompt: 'hi',
        maxTurns: 3,
        queryFn: hitsMaxTurns as never,
      }),
    )

    const result = out.at(-1) as Record<string, unknown>
    expect(result.type).toBe('result')
    expect(result.subtype).toBe('error_max_turns')
    expect(result.is_error).toBe(true)
    // The success result must not also be emitted — the turn stops at max turns.
    const results = out.filter(m => m.type === 'result')
    expect(results).toHaveLength(1)
  })

  test('a throwing query becomes an error_during_execution result, never a thrown error', async () => {
    const out = await drain(
      runHeadlessTurn({
        ...baseOpts,
        prompt: 'hi',
        queryFn: throwsMidTurn as never,
      }),
    )

    const result = out.at(-1) as Record<string, unknown>
    expect(result.type).toBe('result')
    expect(result.subtype).toBe('error_during_execution')
    expect(result.is_error).toBe(true)
    expect((result.errors as string[])[0]).toContain('boom')
  })

  test('accumulates usage/stop_reason across stream events and reports the final assistant text', async () => {
    const out = await drain(
      runHeadlessTurn({
        ...baseOpts,
        prompt: 'hi',
        queryFn: usageAndFinalTextTurn as never,
      }),
    )

    const result = out.at(-1) as Record<string, unknown>
    expect(result.type).toBe('result')
    expect(result.subtype).toBe('success')
    // One 'user' message (the tool result) was seen from the query loop.
    expect(result.num_turns).toBe(1)
    expect(result.result).toBe('final')
    expect(result.stop_reason).toBe('end_turn')
    expect(result.usage).toEqual({
      input_tokens: 10,
      output_tokens: 7,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 3,
    })
  })

  test('a final assistant message ending in tool_use yields an empty result string', async () => {
    const out = await drain(
      runHeadlessTurn({
        ...baseOpts,
        prompt: 'hi',
        queryFn: endsInToolUse as never,
      }),
    )

    const result = out.at(-1) as Record<string, unknown>
    expect(result.type).toBe('result')
    expect(result.subtype).toBe('success')
    expect(result.result).toBe('')
  })
})
