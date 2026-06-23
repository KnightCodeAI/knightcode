import { describe, expect, test } from 'bun:test'
import type { Tool } from '../../Tool.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { createMemorySavedMessage } from '../../utils/messages.js'
import {
  createAutoMemCanUseTool,
  executeExtractMemories,
} from './extractMemories.js'

describe('createMemorySavedMessage', () => {
  test('builds a memory_saved system message carrying the written paths', () => {
    const msg = createMemorySavedMessage(['a.md', 'b.md'])
    expect(msg.type).toBe('system')
    expect(msg.subtype).toBe('memory_saved')
    expect(msg.writtenPaths).toEqual(['a.md', 'b.md'])
    expect(typeof msg.uuid).toBe('string')
  })
})

describe('createAutoMemCanUseTool', () => {
  const canUseTool = createAutoMemCanUseTool('/some/memory/dir')

  test('allows read-only Read unconditionally', async () => {
    const decision = await canUseTool(
      { name: FILE_READ_TOOL_NAME } as unknown as Tool,
      { file_path: '/anywhere.txt' },
    )
    expect(decision.behavior).toBe('allow')
  })

  test('denies an Edit to a path outside the memory directory', async () => {
    const decision = await canUseTool(
      { name: FILE_EDIT_TOOL_NAME } as unknown as Tool,
      { file_path: '/etc/not-memory.conf' },
    )
    expect(decision.behavior).toBe('deny')
  })
})

describe('executeExtractMemories', () => {
  test('is a safe no-op before initExtractMemories() (extractor unset)', async () => {
    // No init in this test → extractor is null; must resolve without throwing.
    await expect(
      executeExtractMemories({
        messages: [],
        toolUseContext: {},
      } as never),
    ).resolves.toBeUndefined()
  })
})
