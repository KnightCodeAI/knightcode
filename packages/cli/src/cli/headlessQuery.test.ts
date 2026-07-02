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

const baseOpts = {
  cwd: process.cwd(),
  dangerouslySkipPermissions: true,
  allowedTools: [] as string[],
  disallowedTools: [] as string[],
  verbose: false,
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
})
