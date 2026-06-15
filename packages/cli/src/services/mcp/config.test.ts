import { describe, expect, it } from 'bun:test'
import { parseMcpConfig } from './config.js'

describe('parseMcpConfig', () => {
  it('parses a valid stdio server into the validated config', () => {
    const { config, errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          fs: { command: 'mcp-server-filesystem', args: ['/tmp'] },
        },
      },
      expandVars: false,
      scope: 'project',
    })

    expect(errors).toEqual([])
    expect(config).not.toBeNull()
    const fs = config?.mcpServers.fs
    expect(fs && 'command' in fs ? fs.command : undefined).toBe(
      'mcp-server-filesystem',
    )
  })

  it('rejects a server config that violates the schema', () => {
    const { config, errors } = parseMcpConfig({
      // stdio server with an empty command — fails `command.min(1)`
      configObject: { mcpServers: { bad: { command: '' } } },
      expandVars: false,
      scope: 'project',
    })

    expect(config).toBeNull()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]?.mcpErrorMetadata?.severity).toBe('fatal')
  })

  it('reports missing environment variables as a warning when expanding', () => {
    delete process.env.MCP_CONFIG_TEST_MISSING
    const { config, errors } = parseMcpConfig({
      configObject: {
        mcpServers: {
          fs: {
            command: 'mcp-server-filesystem',
            args: ['${MCP_CONFIG_TEST_MISSING}'],
          },
        },
      },
      expandVars: true,
      scope: 'project',
    })

    expect(config).not.toBeNull()
    expect(errors.some(e => e.message.includes('Missing environment variables'))).toBe(true)
  })
})
