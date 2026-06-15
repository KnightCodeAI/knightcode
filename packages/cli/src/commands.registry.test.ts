import { describe, expect, test } from 'bun:test'
import { builtInCommandNames, getCommands } from './commands.js'
import { isCommandEnabled } from './types/command.js'

describe('command registry', () => {
  test('getCommands returns the enabled built-in command set', async () => {
    const commands = await getCommands(process.cwd())
    expect(commands.length).toBeGreaterThan(0)
    const names = new Set(commands.map(c => c.name))
    // A core command is present...
    expect(names.has('help')).toBe(true)
    // ...and every returned command passes the enablement filter.
    expect(commands.every(isCommandEnabled)).toBe(true)
  })

  test('out-of-scope commands are filtered out (disabled)', async () => {
    const commands = await getCommands(process.cwd())
    const names = new Set(commands.map(c => c.name))
    // login/logout/teleport are inert (isEnabled false) → not in the list.
    expect(names.has('login')).toBe(false)
    expect(names.has('teleport')).toBe(false)
  })

  test('/mcp is an enabled core command', async () => {
    const commands = await getCommands(process.cwd())
    const names = new Set(commands.map(c => c.name))
    expect(names.has('mcp')).toBe(true)
  })

  test('builtInCommandNames includes core command names', () => {
    const names = builtInCommandNames()
    expect(names.has('help')).toBe(true)
    expect(names.has('compact')).toBe(true)
  })
})
