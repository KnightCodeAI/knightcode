import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type ToolUseContext } from '../../Tool.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from '../../utils/fileStateCache.js'
import { FileReadTool } from './FileReadTool.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'knightcode-read-'))
  writeFileSync(join(dir, 'sample.ts'), 'line one\nline two\nline three', 'utf8')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

// FileReadTool.call reads readFileState, fileReadingLimits, and abortController.
function ctx(): ToolUseContext {
  return {
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE),
  } as unknown as ToolUseContext
}

describe('FileReadTool.call', () => {
  test('reads a text file and reports its lines', async () => {
    const result = await FileReadTool.call(
      { file_path: join(dir, 'sample.ts') },
      ctx(),
    )
    const data = result.data as {
      type: string
      file: { content: string; totalLines: number }
    }
    expect(data.type).toBe('text')
    expect(data.file.content).toContain('line two')
    expect(data.file.totalLines).toBe(3)
  })

  test('honors offset and limit', async () => {
    const result = await FileReadTool.call(
      { file_path: join(dir, 'sample.ts'), offset: 2, limit: 1 },
      ctx(),
    )
    const data = result.data as {
      type: string
      file: { content: string; startLine: number }
    }
    expect(data.type).toBe('text')
    expect(data.file.startLine).toBe(2)
    expect(data.file.content).toContain('line two')
    expect(data.file.content).not.toContain('line one')
  })
})
