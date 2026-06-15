import { test, expect } from 'bun:test'
import { classifyApiError } from './errors.js'

function err(status: number, body: unknown = {}) {
  return Object.assign(new Error('api'), { status, error: body })
}

test('401 → invalid OpenRouter key, no retry', () => {
  const r = classifyApiError(err(401))
  expect(r.message.toLowerCase()).toContain('openrouter api key')
  expect(r.retryable).toBe(false)
})

test('402 → insufficient credits, no retry', () => {
  const r = classifyApiError(err(402))
  expect(r.message.toLowerCase()).toContain('credit')
  expect(r.retryable).toBe(false)
})

test('429 → rate limited, retryable', () => {
  expect(classifyApiError(err(429)).retryable).toBe(true)
})

test('400/404 → unknown model, no retry', () => {
  expect(classifyApiError(err(400)).retryable).toBe(false)
  expect(classifyApiError(err(404)).retryable).toBe(false)
})

test('502/503 → upstream provider error, retryable', () => {
  expect(classifyApiError(err(502)).retryable).toBe(true)
  expect(classifyApiError(err(503)).retryable).toBe(true)
})

test('no 529 Overloaded path remains', () => {
  const r = classifyApiError(err(529))
  expect(r.message).not.toContain('Overloaded')
})
