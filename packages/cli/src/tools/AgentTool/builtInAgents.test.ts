import { describe, expect, test } from 'bun:test'
import { getBuiltInAgents } from './builtInAgents.js'
import { isBuiltInAgent } from './loadAgentsDir.js'

describe('built-in agent definitions', () => {
  test('includes general-purpose, all tagged source: built-in', () => {
    const agents = getBuiltInAgents()
    const types = agents.map(a => a.agentType)

    // general-purpose is always present in the default (non-SDK-disabled) build.
    expect(types).toContain('general-purpose')

    // Every agent the registry returns is a built-in.
    for (const agent of agents) {
      expect(agent.source).toBe('built-in')
      expect(isBuiltInAgent(agent)).toBe(true)
    }
  })

  test('Explore and Plan are gated behind the explore/plan feature flag', () => {
    // BUILTIN_EXPLORE_PLAN_AGENTS is off in this build, so Explore/Plan are not
    // in the default set — guard against a regression that surfaces them.
    const types = getBuiltInAgents().map(a => a.agentType)
    expect(types).not.toContain('Explore')
    expect(types).not.toContain('Plan')
  })
})
