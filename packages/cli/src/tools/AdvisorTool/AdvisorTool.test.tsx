import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from '../../Tool.js'
import { getAllBaseTools } from '../../tools.js'
import {
  ADVISOR_TOOL_INSTRUCTIONS,
  canUserConfigureAdvisor,
  isClientAdvisorEnabled,
  isValidAdvisorModel,
  modelSupportsAdvisor,
} from '../../utils/advisor.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'
import {
  ADVISOR_TOOL_NAME,
  AdvisorTool,
  serializeTranscript,
} from './AdvisorTool.js'
import { ADVISOR_DESCRIPTION } from './prompt.js'

// Under BYOK the first-party server advisor (growthbook-gated) is off, so the
// client-side reconstruction is the active path.
describe('advisor gating (BYOK)', () => {
  test('any non-empty model is a valid advisor model', () => {
    expect(isValidAdvisorModel('openrouter/some-model')).toBe(true)
    expect(isValidAdvisorModel('   ')).toBe(false)
  })

  test('any main-loop model supports the client advisor', () => {
    expect(modelSupportsAdvisor('whatever/model')).toBe(true)
  })

  test('the user can configure the advisor', () => {
    expect(canUserConfigureAdvisor()).toBe(true)
  })

  test('env kill switch disables configuration and the tool', () => {
    const prev = process.env.KNIGHTCODE_CODE_DISABLE_ADVISOR_TOOL
    process.env.KNIGHTCODE_CODE_DISABLE_ADVISOR_TOOL = '1'
    try {
      expect(canUserConfigureAdvisor()).toBe(false)
      expect(isClientAdvisorEnabled()).toBe(false)
    } finally {
      if (prev === undefined)
        delete process.env.KNIGHTCODE_CODE_DISABLE_ADVISOR_TOOL
      else process.env.KNIGHTCODE_CODE_DISABLE_ADVISOR_TOOL = prev
    }
  })
})

describe('AdvisorTool', () => {
  test('basic flags', async () => {
    expect(AdvisorTool.name).toBe(ADVISOR_TOOL_NAME)
    expect(AdvisorTool.isReadOnly()).toBe(true)
    expect(AdvisorTool.isConcurrencySafe()).toBe(true)
    expect(await AdvisorTool.description()).toBe(ADVISOR_DESCRIPTION)
    expect(await AdvisorTool.prompt()).toBe(ADVISOR_TOOL_INSTRUCTIONS)
  })

  test('is listed in the base tool set (self-gates via isEnabled)', () => {
    expect(getAllBaseTools().some(t => t.name === ADVISOR_TOOL_NAME)).toBe(true)
  })
})

describe('serializeTranscript', () => {
  test('renders user and agent turns with their text', () => {
    const ctx = {
      messages: [
        createUserMessage({ content: 'Fix the login bug' }),
        createAssistantMessage({ content: 'Looking at auth.ts now' }),
      ],
      options: { tools: [] },
    } as unknown as ToolUseContext

    const transcript = serializeTranscript(ctx)
    expect(transcript).toContain('## User')
    expect(transcript).toContain('Fix the login bug')
    expect(transcript).toContain('## Agent')
    expect(transcript).toContain('Looking at auth.ts now')
  })
})
