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

  // createAutoMemCanUseTool only inspects tool + input; the remaining
  // CanUseToolFn args (context/message/id) are unused, so stub them.
  const invoke = (tool: Partial<Tool>, input: Record<string, unknown>) =>
    canUseTool(
      tool as never,
      input,
      {} as never,
      {} as never,
      'tool-use-id',
    )

  test('allows read-only Read unconditionally', async () => {
    const decision = await invoke({ name: FILE_READ_TOOL_NAME }, {
      file_path: '/anywhere.txt',
    })
    expect(decision.behavior).toBe('allow')
  })

  test('denies an Edit to a path outside the memory directory', async () => {
    const decision = await invoke({ name: FILE_EDIT_TOOL_NAME }, {
      file_path: '/etc/not-memory.conf',
    })
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
