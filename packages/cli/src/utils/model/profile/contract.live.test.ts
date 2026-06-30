import { describe, expect, test } from 'bun:test'
import { applyModelProfileToBody } from '../../../services/api/modelProfile.js'

const RUN = process.env.KNIGHTCODE_RUN_LIVE_CONTRACT === '1'
const KEY = process.env.OPENROUTER_API_KEY
const FAVORITES = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'poolside/laguna-xs.2:free',
  'qwen/qwen3-coder:free',
]

describe.if(RUN && !!KEY)('live contract: favourite models accept our request shape', () => {
  for (const model of FAVORITES) {
    test(`${model} returns a non-empty answer`, async () => {
      const body = applyModelProfileToBody(
        { model, max_tokens: 512, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] },
        model,
        { effort: 'low', hasThinking: true, budgetTokens: 2000, maxOutputTokens: 512 },
      )
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, 'X-Title': 'KnightCode' },
        body: JSON.stringify(body),
      })
      const json: any = await res.json().catch(() => null)
      expect(res.status).toBe(200)
      const content = json?.choices?.[0]?.message?.content ?? ''
      expect(content.length).toBeGreaterThan(0)
    }, 60000)
  }
})
