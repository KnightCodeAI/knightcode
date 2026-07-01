import { describe, expect, mock, test } from 'bun:test'

// Force the default "never configured" state for teammateDefaultModel so the
// test is deterministic regardless of the developer's real global config.
const actualConfig = await import('../../utils/config.js')
mock.module('../../utils/config.js', () => ({
  ...actualConfig,
  // Static stub (no call back into the real getGlobalConfig — that would
  // recurse through this mock). getDefaultTeammateModel only reads
  // teammateDefaultModel; undefined models the fresh "never configured" state.
  getGlobalConfig: () => ({ teammateDefaultModel: undefined }),
}))

const { resolveTeammateModel } = await import('./spawnMultiAgent.js')

describe('resolveTeammateModel', () => {
  test('inherits the leader model when no teammate default is configured', () => {
    expect(resolveTeammateModel(undefined, 'claude-opus-4-8')).toBe(
      'claude-opus-4-8',
    )
  })

  test("inherits the leader model for the 'inherit' alias", () => {
    expect(resolveTeammateModel('inherit', 'claude-opus-4-8')).toBe(
      'claude-opus-4-8',
    )
  })

  test('falls back to the hardcoded free model only when there is no leader', () => {
    expect(resolveTeammateModel(undefined, null)).toBe('qwen/qwen3-coder:free')
  })
})
