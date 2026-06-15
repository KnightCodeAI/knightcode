import { test, expect, afterEach } from 'bun:test'
import { join } from 'path'
import { homedir } from 'os'
import { getKnightcodeConfigHomeDir } from './envUtils.js'

afterEach(() => {
  delete process.env.KNIGHTCODE_CONFIG_DIR
  delete process.env.KNIGHTCODE_HOME
})

test('honors KNIGHTCODE_CONFIG_DIR', () => {
  const target = join(homedir(), 'kc-cfg-test')
  process.env.KNIGHTCODE_CONFIG_DIR = target
  expect(getKnightcodeConfigHomeDir()).toBe(target.normalize('NFC'))
})

test('falls back to KNIGHTCODE_HOME', () => {
  delete process.env.KNIGHTCODE_CONFIG_DIR
  const target = join(homedir(), 'kc-home-test')
  process.env.KNIGHTCODE_HOME = target
  expect(getKnightcodeConfigHomeDir()).toBe(target.normalize('NFC'))
})

test('defaults to ~/.knightcode, never ~/.claude', () => {
  delete process.env.KNIGHTCODE_CONFIG_DIR
  delete process.env.KNIGHTCODE_HOME
  const resolved = getKnightcodeConfigHomeDir()
  expect(resolved).toBe(join(homedir(), '.knightcode').normalize('NFC'))
  expect(resolved).not.toContain('.claude')
})
