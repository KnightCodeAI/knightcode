import { afterEach, describe, expect, test } from 'bun:test'
import {
  isVerificationAgentEnabled,
  VERIFICATION_AGENT_TYPE,
} from '../tools/AgentTool/constants.js'
import { getBuiltInAgents } from '../tools/AgentTool/builtInAgents.js'
import initVerifiers from './init-verifiers.js'

describe('isVerificationAgentEnabled (BYOK)', () => {
  afterEach(() => {
    delete process.env.KNIGHTCODE_DISABLE_VERIFICATION_AGENT
  })

  test('enabled by default on interactive entrypoints', () => {
    expect(isVerificationAgentEnabled()).toBe(true)
  })

  test('disabled by the env kill switch', () => {
    process.env.KNIGHTCODE_DISABLE_VERIFICATION_AGENT = '1'
    expect(isVerificationAgentEnabled()).toBe(false)
  })
})

describe('verification agent registration', () => {
  test('the verification agent is a built-in agent under BYOK', () => {
    const agents = getBuiltInAgents()
    expect(
      agents.some(a => a.agentType === VERIFICATION_AGENT_TYPE),
    ).toBe(true)
  })
})

describe('/init-verifiers command', () => {
  test('is a prompt command with no disabled/hidden gate', () => {
    expect(initVerifiers.type).toBe('prompt')
    // No isEnabled/isHidden fields on the definition → enabled + visible by default.
    expect('isEnabled' in initVerifiers).toBe(false)
    expect('isHidden' in initVerifiers).toBe(false)
  })

  test('emits the real verifier-creation prompt (BYOK-rebranded)', async () => {
    if (initVerifiers.type !== 'prompt') throw new Error('unreachable')
    const blocks = await initVerifiers.getPromptForCommand()
    const text = blocks
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('\n')
    expect(text.length).toBeGreaterThan(500)
    expect(text).toContain('.knightcode/skills/')
    expect(text).toContain('verifier')
    // The skills path must be rebranded — the upstream dot-path must not leak.
    expect(text).not.toContain(['.cl', 'aude/'].join(''))
  })
})
