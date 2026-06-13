import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { query } from './query.js'
import { getEmptyToolPermissionContext, type ToolUseContext } from './Tool.js'
import type { AppState } from './state/AppState.js'
import type { AssistantMessage, Message } from './types/message.js'
import { FileReadTool } from './tools/FileReadTool/FileReadTool.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from './utils/fileStateCache.js'
import { createAssistantMessage, createUserMessage } from './utils/messages.js'
import { productionDeps, type QueryDeps } from './query/deps.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'knightcode-query-e2e-'))
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

function makeCtx(state: AppState): ToolUseContext {
  return {
    agentId: undefined,
    options: {
      tools: [FileReadTool],
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
    setAppState: (f: (prev: AppState) => AppState) => {
      Object.assign(state, f(state))
    },
    readFileState: createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE),
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    appendSystemMessage: () => {},
    sendOSNotification: () => {},
    messages: [],
    fileReadingLimits: { maxSizeBytes: 10 * 1024 * 1024 },
  } as unknown as ToolUseContext
}

describe('query end-to-end loop', () => {
  test('runs a tool, feeds the result back, and terminates with a final answer', async () => {
    const filePath = join(dir, 'note.txt')
    writeFileSync(filePath, 'hello from disk\n')

    const toolUseId = 'toolu_e2e_read'
    let turn = 0

    // Fake model: turn 1 asks to Read the file; turn 2 (after the tool_result
    // is fed back) gives a final text answer and stops.
    const callModel: QueryDeps['callModel'] = async function* () {
      turn++
      if (turn === 1) {
        yield createAssistantMessage({
          content: [
            {
              type: 'tool_use',
              id: toolUseId,
              name: 'Read',
              input: { file_path: filePath },
            } as unknown as ToolUseBlock,
          ] as never,
        }) as AssistantMessage
      } else {
        yield createAssistantMessage({
          content: [{ type: 'text', text: 'The file says hello.' }] as never,
        }) as AssistantMessage
      }
    }

    const state = makeState()
    const ctx = makeCtx(state)

    const collected: Message[] = []
    const gen = query({
      messages: [createUserMessage({ content: 'read the file then answer' })],
      systemPrompt: ['You are a helpful assistant.'] as never,
      userContext: {},
      systemContext: {},
      canUseTool: (async (
        _tool: unknown,
        input: Record<string, unknown>,
      ) => ({
        behavior: 'allow',
        updatedInput: input,
      })) as never,
      toolUseContext: ctx,
      querySource: 'test' as never,
      deps: { ...productionDeps(), callModel },
    })

    let result = await gen.next()
    while (!result.done) {
      collected.push(result.value as Message)
      result = await gen.next()
    }

    // The loop terminated normally.
    expect(result.value.reason).toBe('completed')

    // A tool_result for our tool_use_id was produced and fed back.
    const toolResult = collected.find(
      m =>
        m.type === 'user' &&
        Array.isArray(m.message.content) &&
        m.message.content.some(
          b => b.type === 'tool_result' && b.tool_use_id === toolUseId,
        ),
    )
    expect(toolResult).toBeDefined()

    // The final assistant message carries the closing text.
    const finalText = collected.some(
      m =>
        m.type === 'assistant' &&
        Array.isArray(m.message.content) &&
        m.message.content.some(
          b => b.type === 'text' && b.text.includes('The file says hello.'),
        ),
    )
    expect(finalText).toBe(true)

    // The Read tool actually ran at least twice through the model.
    expect(turn).toBe(2)
  })
})
