import { describe, expect, test } from 'bun:test'
import { classifyApiError } from './api/errors.js'
import { RATE_LIMIT_MESSAGE, isRateLimitErrorMessage } from './rateLimitMessages.js'

describe('isRateLimitErrorMessage', () => {
  test('matches the canonical rate-limit text', () => {
    expect(isRateLimitErrorMessage(RATE_LIMIT_MESSAGE)).toBe(true)
  })

  test('matches the real prefixed assistant error text', () => {
    expect(isRateLimitErrorMessage(`API Error: ${RATE_LIMIT_MESSAGE}`)).toBe(
      true,
    )
  })

  test('does not false-positive on normal model output mentioning rate limits', () => {
    expect(
      isRateLimitErrorMessage(
        'To avoid hitting a rate limit, batch your requests and add backoff.',
      ),
    ).toBe(false)
  })
})

describe('producer/detector agreement', () => {
  test('a 429 classifies to the same text the detector matches', () => {
    const { message, retryable } = classifyApiError({ status: 429 })
    expect(message).toBe(RATE_LIMIT_MESSAGE)
    expect(retryable).toBe(true)
    // The assistant error text is `API Error: <message>` — must be detected.
    expect(isRateLimitErrorMessage(`API Error: ${message}`)).toBe(true)
  })
})
