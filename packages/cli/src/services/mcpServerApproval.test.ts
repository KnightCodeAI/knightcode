import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { setIsInteractive } from '../bootstrap/state.js'
import { getProjectMcpServerStatus } from './mcp/utils.js'
import {
  resetSettingsCache,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

// The approval dialogs persist the user's choice via updateSettingsForSource
// (enabled/disabled Mcpjson lists), which getProjectMcpServerStatus reads back.
// This verifies that approve/reject round-trip end to end (the dialogs
// themselves render through the TUI and aren't unit-testable here).

const prevConfigDir = process.env.KNIGHTCODE_CONFIG_DIR

function restoreEnv(): void {
  if (prevConfigDir === undefined) delete process.env.KNIGHTCODE_CONFIG_DIR
  else process.env.KNIGHTCODE_CONFIG_DIR = prevConfigDir
  setIsInteractive(false)
}

describe('MCP project server approval round-trip', () => {
  beforeEach(() => {
    process.env.KNIGHTCODE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'kc-mcp-'))
    // Interactive: otherwise getProjectMcpServerStatus auto-approves pending
    // project servers (no popup possible in non-interactive/SDK mode).
    setIsInteractive(true)
    resetSettingsCache()
  })
  afterEach(() => {
    restoreEnv()
    resetSettingsCache()
  })
  afterAll(restoreEnv)

  test('an unknown project server is pending', () => {
    expect(getProjectMcpServerStatus('my-server')).toBe('pending')
  })

  test('approving (enabledMcpjsonServers) flips it to approved', () => {
    updateSettingsForSource('userSettings', {
      enabledMcpjsonServers: ['my-server'],
    })
    expect(getProjectMcpServerStatus('my-server')).toBe('approved')
  })

  test('rejecting (disabledMcpjsonServers) flips it to rejected', () => {
    updateSettingsForSource('userSettings', {
      disabledMcpjsonServers: ['my-server'],
    })
    expect(getProjectMcpServerStatus('my-server')).toBe('rejected')
  })

  test('enableAllProjectMcpServers approves any server', () => {
    updateSettingsForSource('userSettings', {
      enableAllProjectMcpServers: true,
    })
    expect(getProjectMcpServerStatus('anything')).toBe('approved')
  })
})
