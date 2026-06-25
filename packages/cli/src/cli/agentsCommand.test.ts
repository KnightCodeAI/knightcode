import { afterAll, describe, expect, mock, test } from 'bun:test'

// Stub only the disk-scanning loader so the listing is hermetic; the real
// getActiveAgentsFromList + agentDisplay helpers run against this set so the
// source-precedence/override logic under test is the production logic.
// Restore the module afterAll — Bun's mock.module is process-global and would
// otherwise leak into loadAgentsDir.test.ts.
const actualLoad = await import('../tools/AgentTool/loadAgentsDir.js')
type FakeAgent = { agentType: string; source: string; model?: string }
let fakeAgents: FakeAgent[] = []
mock.module('../tools/AgentTool/loadAgentsDir.js', () => ({
  ...actualLoad,
  getAgentDefinitionsWithOverrides: async () => ({
    allAgents: fakeAgents,
    activeAgents: fakeAgents,
  }),
}))

afterAll(() => {
  mock.module('../tools/AgentTool/loadAgentsDir.js', () => actualLoad)
})

const { isAgentsSubcommand } = await import('./agentsCommand.js')
const { agentsHandler } = await import('./handlers/agents.js')

/** Capture everything agentsHandler writes to stdout. */
async function captureAgents(): Promise<string> {
  const chunks: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string) => {
    chunks.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    await agentsHandler()
  } finally {
    process.stdout.write = original
  }
  return chunks.join('')
}

describe('isAgentsSubcommand', () => {
  test('true only when argv[2] is "agents"', () => {
    expect(isAgentsSubcommand(['node', 'cli', 'agents'])).toBe(true)
    expect(isAgentsSubcommand(['node', 'cli', 'doctor'])).toBe(false)
    expect(isAgentsSubcommand(['node', 'cli'])).toBe(false)
  })
})

describe('agentsHandler', () => {
  test('reports "No agents found." when there are none', async () => {
    fakeAgents = []
    const out = await captureAgents()
    expect(out).toContain('No agents found.')
  })

  test('groups agents by source with an active count', async () => {
    fakeAgents = [
      { agentType: 'reviewer', source: 'userSettings', model: 'inherit' },
      { agentType: 'general-purpose', source: 'built-in', model: 'inherit' },
    ]
    const out = await captureAgents()
    expect(out).toContain('2 active agents')
    expect(out).toContain('User agents:')
    expect(out).toContain('reviewer')
    expect(out).toContain('Built-in agents:')
    expect(out).toContain('general-purpose')
  })

  test('marks an agent shadowed by a higher-priority source', async () => {
    // A built-in `reviewer` shadowed by a user-defined one of the same type.
    fakeAgents = [
      { agentType: 'reviewer', source: 'userSettings', model: 'inherit' },
      { agentType: 'reviewer', source: 'built-in', model: 'inherit' },
    ]
    const out = await captureAgents()
    // Only the winning (user) copy counts as active.
    expect(out).toContain('1 active agents')
    expect(out).toContain('(shadowed by user)')
  })
})
