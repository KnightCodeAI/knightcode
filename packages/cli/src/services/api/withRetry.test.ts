import { describe, expect, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import { APIError, APIUserAbortError } from '@anthropic-ai/sdk'
import type { SystemAPIErrorMessage } from '../../types/message.js'
import { FallbackTriggeredError, withRetry } from './withRetry.js'

const fakeClient = {} as Anthropic
const getClient = () => Promise.resolve(fakeClient)

// retry-after: 0 keeps backoff at 0ms so tests run instantly.
function apiError(status: number, message = `status ${status}`): APIError {
  return new APIError(
    status,
    { type: 'error', error: { type: 'api_error', message } },
    message,
    new Headers({ 'retry-after': '0' }),
  )
}

const baseOptions = {
  model: 'anthropic/claude-3.5-haiku',
  thinkingConfig: { type: 'disabled' } as const,
  querySource: 'repl_main_thread' as const,
}

async function drain<T>(
  gen: AsyncGenerator<SystemAPIErrorMessage, T>,
): Promise<{ yields: SystemAPIErrorMessage[]; value: T }> {
  const yields: SystemAPIErrorMessage[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) return { yields, value: next.value }
    yields.push(next.value)
  }
}

describe('withRetry', () => {
  test('returns immediately on success', async () => {
    const { yields, value } = await drain(
      withRetry(getClient, async () => 'ok', baseOptions),
    )
    expect(value).toBe('ok')
    expect(yields).toHaveLength(0)
  })

  test('retries a 500 and yields a retry notice', async () => {
    let calls = 0
    const { yields, value } = await drain(
      withRetry(
        getClient,
        async () => {
          calls++
          if (calls < 3) throw apiError(500)
          return 'recovered'
        },
        baseOptions,
      ),
    )
    expect(value).toBe('recovered')
    expect(calls).toBe(3)
    expect(yields.length).toBeGreaterThanOrEqual(2)
    expect(yields[0]!.subtype).toBe('api_error')
    expect(yields[0]!.retryAttempt).toBe(1)
  })

  test('does not retry a 400', async () => {
    let calls = 0
    const gen = withRetry(
      getClient,
      async () => {
        calls++
        throw apiError(400, 'invalid request')
      },
      baseOptions,
    )
    await expect(drain(gen)).rejects.toThrow('invalid request')
    expect(calls).toBe(1)
  })

  test('repeated 529s on an Opus primary trigger the fallback model', async () => {
    const gen = withRetry(
      getClient,
      async () => {
        throw apiError(529, 'Overloaded')
      },
      {
        ...baseOptions,
        model: 'anthropic/claude-opus-4.6',
        fallbackModel: 'anthropic/claude-sonnet-4.6',
      },
    )
    await expect(drain(gen)).rejects.toBeInstanceOf(FallbackTriggeredError)
  })

  test('an aborted signal surfaces as a user abort', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    const gen = withRetry(
      getClient,
      async () => {
        calls++
        throw apiError(500)
      },
      { ...baseOptions, signal: controller.signal },
    )
    await expect(drain(gen)).rejects.toBeInstanceOf(APIUserAbortError)
    expect(calls).toBeLessThanOrEqual(1)
  })
})
