import { describe, expect, test } from 'bun:test'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { AppState } from '../../state/AppState.js'
import { getHookEventMetadata } from './hooksConfigManager.js'
import { addSessionHook, getSessionHooks } from './sessionHooks.js'
import type { BashCommandHook } from '../../schemas/hooks.js'

describe('hook event metadata', () => {
  test('describes the PreToolUse event and surfaces matchable tool names', () => {
    const meta = getHookEventMetadata(['Bash', 'Edit'])
    expect(meta.PreToolUse.summary).toBe('Before tool execution')
    expect(meta.PreToolUse.matcherMetadata?.values).toContain('Bash')
  })
})

describe('session hook registry', () => {
  test('registers a command hook for an event and reads it back', () => {
    let state = getDefaultAppState() as AppState
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    const hook: BashCommandHook = {
      type: 'command',
      command: 'echo hi',
    }
    addSessionHook(setAppState, 'sess-1', 'PreToolUse', 'Bash', hook)

    const hooks = getSessionHooks(state, 'sess-1', 'PreToolUse')
    const matchers = hooks.get('PreToolUse')
    expect(matchers).toBeDefined()
    expect(matchers!.length).toBeGreaterThan(0)
  })
})
