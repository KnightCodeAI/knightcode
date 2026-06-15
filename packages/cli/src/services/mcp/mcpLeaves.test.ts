import { describe, expect, it } from 'bun:test'
import type { Tool } from '../../Tool.js'
import { expandEnvVarsInString } from './envExpansion.js'
import { normalizeNameForMCP } from './normalization.js'
import { isMcpTool } from './utils.js'

describe('expandEnvVarsInString', () => {
  it('expands a defined variable and reports none missing', () => {
    process.env.MCP_LEAF_TEST_VAR = 'world'
    const { expanded, missingVars } = expandEnvVarsInString('hello ${MCP_LEAF_TEST_VAR}')
    expect(expanded).toBe('hello world')
    expect(missingVars).toEqual([])
    delete process.env.MCP_LEAF_TEST_VAR
  })

  it('uses the :- default when the variable is unset', () => {
    delete process.env.MCP_LEAF_MISSING
    const { expanded, missingVars } = expandEnvVarsInString('${MCP_LEAF_MISSING:-fallback}')
    expect(expanded).toBe('fallback')
    expect(missingVars).toEqual([])
  })

  it('tracks a missing variable with no default and leaves it untouched', () => {
    delete process.env.MCP_LEAF_MISSING
    const { expanded, missingVars } = expandEnvVarsInString('${MCP_LEAF_MISSING}')
    expect(expanded).toBe('${MCP_LEAF_MISSING}')
    expect(missingVars).toEqual(['MCP_LEAF_MISSING'])
  })
})

describe('normalizeNameForMCP', () => {
  it('replaces characters outside [a-zA-Z0-9_-] with underscores', () => {
    expect(normalizeNameForMCP('my server.name/v1')).toBe('my_server_name_v1')
  })
})

describe('isMcpTool', () => {
  it('classifies a prefixed tool as MCP and a built-in as not', () => {
    expect(isMcpTool({ name: 'mcp__github__search' } as Tool)).toBe(true)
    expect(isMcpTool({ name: 'Bash' } as Tool)).toBe(false)
  })
})
