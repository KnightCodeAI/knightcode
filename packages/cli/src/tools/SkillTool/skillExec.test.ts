import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { SkillTool } from './SkillTool.js'
import { SKILL_TOOL_NAME } from './constants.js'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { getDefaultAppState, type AppState } from '../../state/AppState.js'
import {
  createFileStateCacheWithSizeLimit,
  READ_FILE_STATE_CACHE_SIZE,
} from '../../utils/fileStateCache.js'
import { createAssistantMessage } from '../../utils/messages.js'
import type { AssistantMessage } from '../../types/message.js'
import { initBundledSkills } from '../../skills/bundled/index.js'
import { clearBundledSkills } from '../../skills/bundledSkills.js'

beforeAll(() => {
  clearBundledSkills()
  initBundledSkills()
})
afterAll(() => {
  clearBundledSkills()
})

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

const parentMessage = createAssistantMessage({
  content: [
    {
      type: 'tool_use',
      id: 'toolu_skill_test',
      name: SKILL_TOOL_NAME,
      input: { skill: 'simplify' },
    } as never,
  ] as never,
}) as AssistantMessage

describe('SkillTool inline execution', () => {
  test('runs a bundled inline skill and returns its commandName', async () => {
    const ctx = makeCtx(makeState())
    const result = await SkillTool.call(
      { skill: 'simplify' } as never,
      ctx,
      (async () => ({ behavior: 'allow' })) as never,
      parentMessage,
    )
    expect(result.data).toBeDefined()
    expect((result.data as { commandName?: string }).commandName).toBe(
      'simplify',
    )
    expect((result.data as { success?: boolean }).success).toBe(true)
  })
})
