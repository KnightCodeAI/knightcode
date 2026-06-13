import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type {
  ContentBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../../Tool.js'
import type { AppState } from '../../state/AppState.js'
import type { AssistantMessage, UserMessage } from '../../types/message.js'
import type { PermissionDecision } from '../../types/permissions.js'
import type { Tool } from '../../Tool.js'
import { FileReadTool } from '../../tools/FileReadTool/FileReadTool.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from '../../utils/fileStateCache.js'
import { createAssistantMessage } from '../../utils/messages.js'
import { runTools } from './toolOrchestration.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'knightcode-orchestration-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeState(): AppState {
  return {
    toolPermissionContext: getEmptyToolPermissionContext(),
    todos: {},
    tasks: {},
    mcp: { clients: [], commands: [], tools: [] },
    inbox: { messages: [] },
  } as AppState
}

// A context exposing only the fields the serial/concurrent tool paths read.
function makeCtx(state: AppState): ToolUseContext {
  return {
    options: {
      tools: [FileReadTool],
      mcpClients: [],
    },
    abortController: new AbortController(),
    getAppState: () => state,
    setAppState: (f: (prev: AppState) => AppState) => {
      Object.assign(state, f(state))
    },
    readFileState: createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE),
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    messages: [],
    fileReadingLimits: { maxSizeBytes: 10 * 1024 * 1024 },
  } as unknown as ToolUseContext
}

// canUseTool that always allows, mirroring the rule-based allow decision.
const allow: (
  tool: Tool,
  input: Record<string, unknown>,
) => Promise<PermissionDecision> = async (_tool, input) => ({
  behavior: 'allow',
  updatedInput: input,
})

describe('runTools serial orchestration', () => {
  test('a single Read tool use produces a matching tool_result', async () => {
    const filePath = join(dir, 'note.txt')
    writeFileSync(filePath, 'alpha\nbeta\n')

    const state = makeState()
    const ctx = makeCtx(state)

    const toolUseId = 'toolu_read_1'
    const toolUse = {
      type: 'tool_use',
      id: toolUseId,
      name: 'Read',
      input: { file_path: filePath },
    } as unknown as ToolUseBlock

    const assistant = createAssistantMessage({
      content: [toolUse] as never,
    }) as AssistantMessage

    const resultMessages: UserMessage[] = []
    for await (const update of runTools(
      [toolUse],
      [assistant],
      allow as never,
      ctx,
    )) {
      if (update.message && update.message.type === 'user') {
        resultMessages.push(update.message)
      }
    }

    // Find the user message carrying the tool_result for our tool_use_id.
    const toolResult = resultMessages.find(
      m =>
        Array.isArray(m.message.content) &&
        m.message.content.some(
          block =>
            block.type === 'tool_result' && block.tool_use_id === toolUseId,
        ),
    )
    expect(toolResult).toBeDefined()

    const block = (toolResult!.message.content as ContentBlockParam[]).find(
      b => b.type === 'tool_result',
    )
    expect(block).toBeDefined()
    expect((block as { tool_use_id: string }).tool_use_id).toBe(toolUseId)
  })
})
