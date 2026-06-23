import { describe, expect, test } from 'bun:test'
import {
  type AgentDefinition,
  type CustomAgentDefinition,
  filterAgentsByMcpRequirements,
  getActiveAgentsFromList,
  hasRequiredMcpServers,
  parseAgentFromJson,
  parseAgentFromMarkdown,
  parseAgentsFromJson,
} from './loadAgentsDir.js'

function makeCustom(
  agentType: string,
  source: CustomAgentDefinition['source'],
  extra: Partial<CustomAgentDefinition> = {},
): CustomAgentDefinition {
  return {
    agentType,
    whenToUse: `use ${agentType}`,
    getSystemPrompt: () => '',
    source,
    ...extra,
  }
}

describe('parseAgentFromMarkdown', () => {
  test('parses a valid agent file', () => {
    const agent = parseAgentFromMarkdown(
      '/proj/.knightcode/agents/reviewer.md',
      '/proj/.knightcode/agents',
      {
        name: 'reviewer',
        description: 'Reviews code changes',
        tools: 'Read, Grep',
        model: 'opus',
      },
      'You are a code reviewer.',
      'projectSettings',
    )

    expect(agent).not.toBeNull()
    expect(agent!.agentType).toBe('reviewer')
    expect(agent!.whenToUse).toBe('Reviews code changes')
    expect(agent!.source).toBe('projectSettings')
    expect(agent!.filename).toBe('reviewer')
    expect(agent!.tools).toEqual(['Read', 'Grep'])
    expect(agent!.model).toBe('opus')
    expect(agent!.getSystemPrompt()).toBe('You are a code reviewer.')
  })

  test('returns null when name is missing (co-located doc)', () => {
    const agent = parseAgentFromMarkdown(
      '/proj/.knightcode/agents/README.md',
      '/proj/.knightcode/agents',
      { description: 'just docs' },
      'some reference content',
      'projectSettings',
    )
    expect(agent).toBeNull()
  })

  test('returns null when description is missing', () => {
    const agent = parseAgentFromMarkdown(
      '/proj/.knightcode/agents/x.md',
      '/proj/.knightcode/agents',
      { name: 'x' },
      'content',
      'userSettings',
    )
    expect(agent).toBeNull()
  })

  test("model: 'inherit' is normalized to 'inherit'", () => {
    const agent = parseAgentFromMarkdown(
      '/a.md',
      '/',
      { name: 'a', description: 'd', model: 'INHERIT' },
      'p',
      'userSettings',
    )
    expect(agent!.model).toBe('inherit')
  })

  test('rejects non-ant isolation: remote, accepts worktree', () => {
    const remote = parseAgentFromMarkdown(
      '/a.md',
      '/',
      { name: 'a', description: 'd', isolation: 'remote' },
      'p',
      'userSettings',
    )
    // External (non-ant) build rejects 'remote' — field omitted.
    expect(remote!.isolation).toBeUndefined()

    const worktree = parseAgentFromMarkdown(
      '/b.md',
      '/',
      { name: 'b', description: 'd', isolation: 'worktree' },
      'p',
      'userSettings',
    )
    expect(worktree!.isolation).toBe('worktree')
  })

  test('unescapes \\n in description', () => {
    const agent = parseAgentFromMarkdown(
      '/a.md',
      '/',
      { name: 'a', description: 'line1\\nline2' },
      'p',
      'userSettings',
    )
    expect(agent!.whenToUse).toBe('line1\nline2')
  })
})

describe('parseAgentFromJson / parseAgentsFromJson', () => {
  test('parses a valid JSON agent', () => {
    const agent = parseAgentFromJson(
      'helper',
      { description: 'helps', prompt: 'You help.', tools: ['Read'] },
      'flagSettings',
    )
    expect(agent).not.toBeNull()
    expect(agent!.agentType).toBe('helper')
    expect(agent!.whenToUse).toBe('helps')
    expect(agent!.tools).toEqual(['Read'])
    expect(agent!.getSystemPrompt()).toBe('You help.')
  })

  test('returns null on invalid JSON agent (empty prompt)', () => {
    const agent = parseAgentFromJson('bad', {
      description: 'd',
      prompt: '',
    })
    expect(agent).toBeNull()
  })

  test('parseAgentsFromJson parses a map of valid agents', () => {
    const agents = parseAgentsFromJson({
      a: { description: 'a', prompt: 'pa' },
      b: { description: 'b', prompt: 'pb' },
    })
    expect(agents.map(x => x.agentType).sort()).toEqual(['a', 'b'])
  })

  test('parseAgentsFromJson returns [] when any entry is invalid (strict record parse)', () => {
    const agents = parseAgentsFromJson({
      good: { description: 'g', prompt: 'p' },
      bad: { description: 'b' }, // missing prompt -> whole record parse fails
    })
    expect(agents).toEqual([])
  })
})

describe('getActiveAgentsFromList', () => {
  test('later sources override earlier ones by agentType', () => {
    const builtIn: AgentDefinition = {
      agentType: 'reviewer',
      whenToUse: 'built-in',
      source: 'built-in',
      baseDir: 'built-in',
      getSystemPrompt: () => 'built-in',
    }
    const user = makeCustom('reviewer', 'userSettings', {
      whenToUse: 'user',
    })
    const project = makeCustom('reviewer', 'projectSettings', {
      whenToUse: 'project',
    })

    const active = getActiveAgentsFromList([builtIn, user, project])
    expect(active).toHaveLength(1)
    expect(active[0]!.whenToUse).toBe('project')
  })

  test('keeps distinct agent types', () => {
    const a = makeCustom('a', 'userSettings')
    const b = makeCustom('b', 'projectSettings')
    const active = getActiveAgentsFromList([a, b])
    expect(active.map(x => x.agentType).sort()).toEqual(['a', 'b'])
  })
})

describe('hasRequiredMcpServers / filterAgentsByMcpRequirements', () => {
  test('agent with no requirements is always available', () => {
    const agent = makeCustom('a', 'userSettings')
    expect(hasRequiredMcpServers(agent, [])).toBe(true)
  })

  test('requires every pattern to match some server (case-insensitive substring)', () => {
    const agent = makeCustom('a', 'userSettings', {
      requiredMcpServers: ['slack'],
    })
    expect(hasRequiredMcpServers(agent, ['MySlackServer'])).toBe(true)
    expect(hasRequiredMcpServers(agent, ['github'])).toBe(false)
  })

  test('filterAgentsByMcpRequirements drops unsatisfied agents', () => {
    const ok = makeCustom('ok', 'userSettings', {
      requiredMcpServers: ['slack'],
    })
    const missing = makeCustom('missing', 'userSettings', {
      requiredMcpServers: ['jira'],
    })
    const filtered = filterAgentsByMcpRequirements(
      [ok, missing],
      ['slack-prod'],
    )
    expect(filtered.map(a => a.agentType)).toEqual(['ok'])
  })
})
