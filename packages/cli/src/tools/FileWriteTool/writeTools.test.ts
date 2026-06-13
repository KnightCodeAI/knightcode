import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type ToolUseContext } from '../../Tool.js'
import {
  createFileStateCacheWithSizeLimit,
  type FileStateCache,
  READ_FILE_STATE_CACHE_SIZE,
} from '../../utils/fileStateCache.js'
import { FileWriteTool } from './FileWriteTool.js'
import { FileEditTool } from '../FileEditTool/FileEditTool.js'

const dirs: string[] = []
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'knightcode-write-'))
  dirs.push(d)
  return d
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

let readFileState: FileStateCache

beforeEach(() => {
  readFileState = createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE)
})

// Write/Edit read only these context fields off the context object.
function ctx(): ToolUseContext {
  return {
    abortController: new AbortController(),
    readFileState,
    updateFileHistoryState: () => {},
    dynamicSkillDirTriggers: new Set<string>(),
  } as unknown as ToolUseContext
}

const parent = { type: 'assistant' } as never

describe('FileWriteTool.call', () => {
  test('creates a new file with the given content', async () => {
    const dir = freshDir()
    const target = join(dir, 'created.txt')
    const result = await FileWriteTool.call(
      { file_path: target, content: 'hello world\n' },
      ctx(),
      undefined as never,
      parent,
    )
    expect((result.data as { type: string }).type).toBe('create')
    expect(readFileSync(target, 'utf8')).toBe('hello world\n')
  })
})

describe('FileEditTool.call', () => {
  test('replaces a string in a previously-read file', async () => {
    const dir = freshDir()
    const target = join(dir, 'edit-me.txt')
    writeFileSync(target, 'const value = 1\n', 'utf8')

    // Edit requires the file to have been read first: seed read state with a
    // timestamp at/after the file's mtime so the unchanged-since-read check passes.
    readFileState.set(target, {
      content: 'const value = 1\n',
      timestamp: Math.ceil(statSync(target).mtimeMs) + 1000,
      offset: 0,
      limit: undefined,
    })

    const result = await FileEditTool.call(
      { file_path: target, old_string: 'value = 1', new_string: 'value = 2' },
      ctx(),
      undefined as never,
      parent,
    )
    expect((result.data as { newString: string }).newString).toBe('value = 2')
    expect(readFileSync(target, 'utf8')).toBe('const value = 2\n')
  })
})
