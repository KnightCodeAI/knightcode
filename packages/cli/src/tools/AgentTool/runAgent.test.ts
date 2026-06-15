import { describe, expect, mock, test } from 'bun:test'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { getDefaultAppState, type AppState } from '../../state/AppState.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from '../../utils/fileStateCache.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import type { AgentDefinition } from './loadAgentsDir.js'

const STREAMED_TEXT = 'hello from the sub-agent'

// runAgent imports query() directly (no dep seam), so replace the module with a
// fake that yields a single assistant message — runAgent should stream it through.
mock.module('../../query.js', () => ({
  query: async function* () {
    yield createAssistantMessage({
      content: [{ type: 'text', text: STREAMED_TEXT }] as never,
    }) as AssistantMessage
  },
}))

const { runAgent } = await import('./runAgent.js')

function makeState(): AppState {
  return {
    ...getDefaultAppState(),
    toolPermissionContext: getEmptyToolPermissionContext(),
  }
}

function makeCtx(state: AppState): ToolUseContext {
  return {
    agentId: undefined,
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

const agentDefinition: AgentDefinition = {
  agentType: 'test-agent',
  whenToUse: 'a trivial agent used to exercise the runAgent loop',
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () => 'You are a test agent.',
}

describe('runAgent execution engine', () => {
  test('streams the assistant message yielded by query through to the caller', async () => {
    const ctx = makeCtx(makeState())
    const collected: Message[] = []

    for await (const message of runAgent({
      agentDefinition,
      promptMessages: [createUserMessage({ content: 'do the thing' })],
      toolUseContext: ctx,
      canUseTool: (async (
        _tool: unknown,
        input: Record<string, unknown>,
      ) => ({ behavior: 'allow', updatedInput: input })) as never,
      isAsync: false,
      querySource: 'test' as never,
      availableTools: [],
      // Pre-supply context/prompt so the loop skips real KNIGHTCODE.md / env reads.
      override: {
        userContext: {},
        systemContext: {},
        systemPrompt: ['You are a test agent.'] as never,
        abortController: new AbortController(),
      },
    })) {
      collected.push(message)
    }

    const assistant = collected.find(
      (m): m is AssistantMessage => m.type === 'assistant',
    )
    expect(assistant).toBeDefined()
    const text = JSON.stringify(assistant?.message.content)
    expect(text).toContain(STREAMED_TEXT)
  })
})
