import { afterEach, describe, expect, mock, test } from 'bun:test'

// gracefulShutdown calls process.exit in production; stub it so the handler
// returns and the runner survives. getAllMcpConfigs is stubbed for a hermetic,
// network-free run.
const actualShutdown = await import('../utils/gracefulShutdown.js')
mock.module('../utils/gracefulShutdown.js', () => ({
  ...actualShutdown,
  gracefulShutdown: async () => {},
}))
const actualMcpConfig = await import('../services/mcp/config.js')
let mockServers: Record<string, { type?: string }> = {}
mock.module('../services/mcp/config.js', () => ({
  ...actualMcpConfig,
  getAllMcpConfigs: async () => ({ servers: mockServers, errors: [] }),
}))

const { isDoctorSubcommand } = await import('./doctorCommand.js')
const { doctorHandler } = await import('./handlers/doctor.js')

/** Capture everything doctorHandler writes to stdout. */
async function captureDoctor(version: string): Promise<string> {
  const chunks: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string) => {
    chunks.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    await doctorHandler(version)
  } finally {
    process.stdout.write = original
  }
  return chunks.join('')
}

afterEach(() => {
  mockServers = {}
})

describe('isDoctorSubcommand', () => {
  test('true only when argv[2] is "doctor"', () => {
    expect(isDoctorSubcommand(['node', 'cli', 'doctor'])).toBe(true)
    expect(isDoctorSubcommand(['node', 'cli', 'mcp'])).toBe(false)
    expect(isDoctorSubcommand(['node', 'cli'])).toBe(false)
  })
})

describe('doctorHandler', () => {
  test('reports the BYOK health sections and the passed version', async () => {
    const out = await captureDoctor('9.9.9')
    expect(out).toContain('KnightCode doctor')
    expect(out).toContain('KnightCode: 9.9.9')
    expect(out).toContain('Platform:')
    expect(out).toContain('API key')
    expect(out).toContain('Config dir:')
    expect(out).toContain('MCP servers')
  })

  test('lists configured MCP servers with their transport', async () => {
    mockServers = { alpha: { type: 'http' }, beta: {} }
    const out = await captureDoctor('1.0.0')
    expect(out).toContain('Configured: 2')
    expect(out).toContain('alpha (http)')
    // No explicit type falls back to stdio.
    expect(out).toContain('beta (stdio)')
  })

  test('reports "none" when no MCP servers are configured', async () => {
    mockServers = {}
    const out = await captureDoctor('1.0.0')
    expect(out).toContain('Configured: none')
  })
})
