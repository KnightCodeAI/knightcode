import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { OpenRouterModel } from './model/openRouterModels.js'
import { setModelCatalogForTests } from './model/openRouterModels.js'
import { getDefaultEffortForModel } from './effort.js'

// Pin the in-memory catalog via the test seam (NOT mock.module — bun module
// mocks are process-global and poison later test files).
//
// Catalog contents:
//   - first-party ids are present and marked reasoning-capable, so ONLY the
//     exclusion guard can explain an undefined result
//   - kimi is a normal reasoning-capable model → default 'medium'
//   - qwen/qwen3-coder:free is absent → cold-catalog path → undefined
const entry = (id: string): OpenRouterModel => ({
  id,
  name: id,
  authorSlug: id.split('/')[0] ?? id,
  contextLength: 128000,
  pricing: { prompt: 0, completion: 0 },
  inputModalities: ['text'],
  supportsTools: true,
  supportsReasoning: true,
  supportedParameters: [],
})

beforeAll(() => {
  setModelCatalogForTests([
    entry('anthropic/claude-sonnet-4.6'),
    entry('claude-3-7-sonnet-20250219'),
    entry('moonshotai/kimi-k2-thinking'),
  ])
})

afterAll(() => {
  setModelCatalogForTests(null)
})

// ------------------------------------------------------------------
// Warm-catalog tests: catalog marks the model reasoning-capable.
// The critical invariant: first-party ids must STILL return undefined so
// no redundant `reasoning` param is sent alongside 1P `thinking`.
// ------------------------------------------------------------------
describe('getDefaultEffortForModel — first-party exclusion (warm catalog)', () => {
  test('anthropic/claude-sonnet-4.6 returns undefined even when catalog marks it reasoning-capable', () => {
    expect(getDefaultEffortForModel('anthropic/claude-sonnet-4.6')).toBeUndefined()
  })

  test('bare claude-sonnet alias also returns undefined (includes-claude- guard)', () => {
    expect(getDefaultEffortForModel('claude-3-7-sonnet-20250219')).toBeUndefined()
  })

  test('non-first-party reasoning model gets medium with a warm catalog', () => {
    expect(getDefaultEffortForModel('moonshotai/kimi-k2-thinking')).toBe('medium')
  })
})

// ------------------------------------------------------------------
// Cold-catalog test: qwen3-coder is absent from the pinned catalog, so
// getDefaultEffortForModel must return undefined.
// ------------------------------------------------------------------
describe('getDefaultEffortForModel — cold catalog (qwen3-coder not in catalog)', () => {
  test('returns undefined for a non-reasoning slug absent from the catalog', () => {
    expect(getDefaultEffortForModel('qwen/qwen3-coder:free')).toBeUndefined()
  })
})
