import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext, type ToolUseContext } from './Tool.js'
import {
  getAllBaseTools,
  getTools,
  getToolsForDefaultPreset,
  filterToolsByDenyRules,
} from './tools.js'
import type { AppState } from './state/AppState.js'
import { FileWriteTool } from './tools/FileWriteTool/FileWriteTool.js'
import { FileReadTool } from './tools/FileReadTool/FileReadTool.js'
import { GlobTool } from './tools/GlobTool/GlobTool.js'
import { GrepTool } from './tools/GrepTool/GrepTool.js'
import { TodoWriteTool } from './tools/TodoWriteTool/TodoWriteTool.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from './utils/fileStateCache.js'
import { permissionRuleValueToString } from './utils/permissions/permissionRuleParser.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'knightcode-registry-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

// A shared mutable AppState so setAppState mutations (TodoWrite) are observable.
function makeState(): AppState {
  return {
    toolPermissionContext: getEmptyToolPermissionContext(),
    todos: {},
  } as AppState
}

// One rich context covering every field the in-scope tools read.
function makeCtx(state: AppState): ToolUseContext {
  return {
    abortController: new AbortController(),
    getAppState: () => state,
    setAppState: (f: (prev: AppState) => AppState) => {
      Object.assign(state, f(state))
    },
    readFileState: createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE),
    updateFileHistoryState: () => {},
    dynamicSkillDirTriggers: new Set<string>(),
    nestedMemoryAttachmentTriggers: new Set<string>(),
    globLimits: { maxResults: 100 },
    fileReadingLimits: { maxBytes: 10 * 1024 * 1024, maxLines: 100_000 },
  } as unknown as ToolUseContext
}

describe('tool registry', () => {
  test('the default preset exposes the in-scope tools', () => {
    const names = new Set(getToolsForDefaultPreset())
    for (const expected of ['Glob', 'Grep', 'Read', 'Edit', 'Write', 'TodoWrite']) {
      expect(names.has(expected)).toBe(true)
    }
  })

  test('every base tool satisfies the core Tool contract', () => {
    for (const tool of getAllBaseTools()) {
      expect(typeof tool.name).toBe('string')
      expect(typeof tool.isEnabled()).toBe('boolean')
      expect(typeof tool.call).toBe('function')
      expect(typeof tool.checkPermissions).toBe('function')
    }
  })

  test('a blanket deny rule removes the tool from getTools', () => {
    const rule = permissionRuleValueToString({ toolName: 'Grep' })
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysDenyRules: { session: [rule] },
    }
    const names = new Set(getTools(ctx).map(t => t.name))
    expect(names.has('Grep')).toBe(false)
    expect(names.has('Read')).toBe(true)
  })

  test('filterToolsByDenyRules leaves tools untouched without a matching rule', () => {
    const kept = filterToolsByDenyRules(
      getAllBaseTools(),
      getEmptyToolPermissionContext(),
    )
    expect(kept.length).toBe(getAllBaseTools().length)
  })
})

describe('end-to-end: each tool through a hand-built context', () => {
  const target = () => join(dir, 'note.txt')
  const parent = { type: 'assistant', message: { id: 'msg-test' } } as never

  test('Write creates a file', async () => {
    const state = makeState()
    const result = await FileWriteTool.call(
      { file_path: target(), content: 'alpha\nbeta\n' },
      makeCtx(state),
      undefined as never,
      parent,
    )
    expect((result.data as { type: string }).type).toBe('create')
  })

  test('Read returns the written content', async () => {
    const state = makeState()
    const result = await FileReadTool.call(
      { file_path: target() },
      makeCtx(state),
      undefined as never,
      parent,
    )
    expect(JSON.stringify(result.data)).toContain('alpha')
  })

  test('Glob finds the file', async () => {
    const state = makeState()
    const result = await GlobTool.call({ pattern: '**/*.txt', path: dir }, makeCtx(state))
    expect(result.data.numFiles).toBeGreaterThanOrEqual(1)
  })

  test('Grep matches content', async () => {
    const state = makeState()
    const result = await GrepTool.call(
      { pattern: 'beta', path: dir },
      makeCtx(state),
    )
    expect(result.data.numFiles).toBeGreaterThanOrEqual(1)
  })

  test('TodoWrite records the checklist in app state', async () => {
    const state = makeState()
    const ctx = makeCtx(state)
    const todos = [
      { content: 'first task', status: 'pending' as const, activeForm: 'Doing first task' },
    ]
    const result = await TodoWriteTool.call({ todos }, ctx)
    expect(result.data.newTodos).toEqual(todos)
    // setAppState persisted the list under the session key.
    const stored = Object.values(state.todos)[0]
    expect(stored).toEqual(todos)
  })
})
