import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { getDefaultAppState, type AppState } from '../../state/AppState.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from '../fileStateCache.js'
import { addSessionHook } from './sessionHooks.js'
import { executePreToolHooks } from '../hooks.js'
import type { BashCommandHook } from '../../schemas/hooks.js'

let dir: string
const SESSION_ID = 'firing-test-session'

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'knightcode-hook-firing-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

// Convert a Windows path (C:\a\b) to the git-bash posix form (/c/a/b) so the
// command works under the default 'bash' hook shell on win32; a no-op elsewhere.
function toPosix(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p)
  if (!m || !m[1] || m[2] === undefined) return p
  return `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
}

describe('hook firing aggregator', () => {
  test('executePreToolHooks spawns a configured command hook', async () => {
    const sentinel = join(dir, 'sentinel.txt')

    let state: AppState = {
      ...getDefaultAppState(),
      toolPermissionContext: getEmptyToolPermissionContext(),
    }
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }

    const hook: BashCommandHook = {
      type: 'command',
      command: `printf done > '${toPosix(sentinel)}'`,
    }
    addSessionHook(setAppState, SESSION_ID, 'PreToolUse', 'Bash', hook)

    const ctx = {
      agentId: SESSION_ID,
      options: {
        tools: [],
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        mainLoopModel: 'anthropic/claude-3.5-haiku',
        thinkingConfig: { type: 'disabled' },
        agentDefinitions: { activeAgents: [], allAgents: [] },
        appendSystemPrompt: undefined,
      },
      abortController: new AbortController(),
      getAppState: () => state,
      setAppState,
      setAppStateForTasks: setAppState,
      readFileState: createFileStateCacheWithSizeLimit(
        READ_FILE_STATE_CACHE_SIZE,
      ),
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      appendSystemMessage: () => {},
      sendOSNotification: () => {},
      messages: [],
      fileReadingLimits: { maxSizeBytes: 10 * 1024 * 1024 },
    } as unknown as ToolUseContext

    // Drain the generator so the spawned command runs to completion.
    for await (const _ of executePreToolHooks(
      'Bash',
      'toolu_firing_test',
      { command: 'ls' },
      ctx,
    )) {
      // consume
    }

    expect(existsSync(sentinel)).toBe(true)
  })
})
