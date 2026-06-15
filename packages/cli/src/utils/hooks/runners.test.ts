import { describe, expect, mock, test } from 'bun:test'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { getDefaultAppState, type AppState } from '../../state/AppState.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from '../fileStateCache.js'

// execPromptHook drives the model through queryModelWithoutStreaming; stub just
// that export (preserving the rest of the module) to return a fixed JSON
// completion so the runner's success path is exercised without a real API key.
const actualKnightcode = await import('../../services/api/knightcode.js')
mock.module('../../services/api/knightcode.js', () => ({
  ...actualKnightcode,
  queryModelWithoutStreaming: async () => ({
    message: { content: [{ type: 'text', text: '{"ok": true}' }] },
  }),
}))

const { execPromptHook } = await import('./execPromptHook.js')

function makeCtx(): ToolUseContext {
  const state: AppState = {
    ...getDefaultAppState(),
    toolPermissionContext: getEmptyToolPermissionContext(),
  }
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
    setAppState: () => {},
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

describe('hook runners', () => {
  test('execPromptHook returns outcome "success" when the model condition is met', async () => {
    const result = await execPromptHook(
      { prompt: 'Is the sky blue?' } as never,
      'TestHook',
      'PreToolUse' as never,
      '{}',
      new AbortController().signal,
      makeCtx(),
    )
    expect((result as { outcome?: string }).outcome).toBe('success')
  })
})
