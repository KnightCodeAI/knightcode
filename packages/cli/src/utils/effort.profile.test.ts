import { describe, expect, test, mock, afterAll } from 'bun:test'

// ------------------------------------------------------------------
// Stub getOpenRouterModel BEFORE importing effort.ts so the replacement
// is in place at module load time (bun mock.module applies per-process).
//
// Behavior of the stub:
//   - qwen/qwen3-coder:free → undefined  (simulates cold catalog: not present)
//   - everything else       → { supportsReasoning: true }  (warm catalog)
//
// This lets us test both the Anthropic-exclusion guard (warm path) and the
// existing cold-catalog behaviour (qwen) in a single file.
// ------------------------------------------------------------------
mock.module('./model/openRouterModels.js', () => ({
  getOpenRouterModel: (id: string) => {
    if (id === 'qwen/qwen3-coder:free') return undefined
    return { supportsReasoning: true }
  },
}))

// Dynamic import: stub must already be live before the module executes.
const { getDefaultEffortForModel } = await import('./effort.js')

// ------------------------------------------------------------------
// Warm-catalog tests: catalog marks the model reasoning-capable.
// The critical invariant: Anthropic ids must STILL return undefined so
// no redundant `reasoning` param is sent alongside 1P `thinking`.
// ------------------------------------------------------------------
describe('getDefaultEffortForModel — Anthropic exclusion (warm catalog)', () => {
  test('anthropic/claude-sonnet-4.6 returns undefined even when catalog marks it reasoning-capable', () => {
    expect(getDefaultEffortForModel('anthropic/claude-sonnet-4.6')).toBeUndefined()
  })

  test('bare claude alias also returns undefined (isAnthropic includes-claude guard)', () => {
    expect(getDefaultEffortForModel('claude-3-7-sonnet-20250219')).toBeUndefined()
  })

  test('non-Anthropic reasoning model gets medium with a warm catalog', () => {
    expect(getDefaultEffortForModel('moonshotai/kimi-k2-thinking')).toBe('medium')
  })
})

// ------------------------------------------------------------------
// Cold-catalog test: qwen3-coder is absent from the catalog (stub returns
// undefined for it), so getDefaultEffortForModel must return undefined.
// ------------------------------------------------------------------
describe('getDefaultEffortForModel — cold catalog (qwen3-coder not in catalog)', () => {
  test('returns undefined for a non-reasoning slug absent from the catalog', () => {
    expect(getDefaultEffortForModel('qwen/qwen3-coder:free')).toBeUndefined()
  })
})

afterAll(() => {
  mock.restore()
})
