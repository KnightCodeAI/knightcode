import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Stub the disk-writing config layer and the process-exiting CLI helpers so the
// `add` action can be exercised without touching disk or killing the runner.
const addCalls: Array<{ name: string; config: unknown; scope: string }> = []
const actualConfig = await import('../services/mcp/config.js')
mock.module('../services/mcp/config.js', () => ({
  ...actualConfig,
  addMcpConfig: async (name: string, config: unknown, scope: string) => {
    addCalls.push({ name, config, scope })
  },
}))

// In production cliOk/cliError call process.exit; here they just record the
// outcome so the action runs to completion and assertions can inspect it.
let lastExit: { kind: 'ok' | 'error'; detail?: string } | undefined
mock.module('./exit.js', () => ({
  cliOk: (detail?: string) => {
    lastExit = { kind: 'ok', detail }
  },
  cliError: (detail?: string) => {
    lastExit = { kind: 'error', detail }
  },
}))

const { isMcpSubcommand, buildMcpProgram } = await import('./mcpCommand.js')

/** Parse args through the `mcp` program (valid inputs only — no parse errors). */
async function runMcp(args: string[]): Promise<void> {
  await buildMcpProgram().parseAsync(args, { from: 'user' })
}

beforeEach(() => {
  addCalls.length = 0
  lastExit = undefined
})

describe('isMcpSubcommand', () => {
  test('true only when argv[2] is "mcp"', () => {
    expect(isMcpSubcommand(['node', 'cli', 'mcp', 'list'])).toBe(true)
    expect(isMcpSubcommand(['node', 'cli', 'mcp'])).toBe(true)
    expect(isMcpSubcommand(['node', 'cli', 'resume'])).toBe(false)
    expect(isMcpSubcommand(['node', 'cli'])).toBe(false)
  })
})

describe('mcp program', () => {
  test('registers the BYOK subcommand set', () => {
    const names = buildMcpProgram()
      .commands.map(c => c.name())
      .sort()
    expect(names).toEqual(
      ['add', 'add-json', 'get', 'list', 'remove', 'reset-project-choices'].sort(),
    )
  })

  test('add (stdio) parses `--` passthrough into command + args', async () => {
    await runMcp(['add', 'demo', '--', 'npx', 'my-server', '--flag'])
    expect(lastExit?.kind).toBe('ok')
    expect(addCalls).toHaveLength(1)
    expect(addCalls[0]!.name).toBe('demo')
    expect(addCalls[0]!.scope).toBe('local')
    expect(addCalls[0]!.config).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['my-server', '--flag'],
      env: {},
    })
  })

  test('add -e sets environment variables', async () => {
    await runMcp(['add', 'demo', '-e', 'API_KEY=xyz', '--', 'serve'])
    expect(addCalls[0]!.config).toMatchObject({
      type: 'stdio',
      command: 'serve',
      env: { API_KEY: 'xyz' },
    })
  })

  test('add --transport http builds an http server config', async () => {
    await runMcp([
      'add',
      '--transport',
      'http',
      '--scope',
      'user',
      'web',
      'https://example.com/mcp',
    ])
    expect(lastExit?.kind).toBe('ok')
    expect(addCalls[0]!.scope).toBe('user')
    expect(addCalls[0]!.config).toMatchObject({
      type: 'http',
      url: 'https://example.com/mcp',
    })
  })

  test('add --header parses headers for an sse server', async () => {
    await runMcp([
      'add',
      '--transport',
      'sse',
      'evt',
      'https://example.com/sse',
      '--header',
      'Authorization: Bearer t0ken',
    ])
    expect(addCalls[0]!.config).toMatchObject({
      type: 'sse',
      url: 'https://example.com/sse',
      headers: { Authorization: 'Bearer t0ken' },
    })
  })
})
