import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'
import { findRelevantMemories } from './findRelevantMemories.js'
import {
  getAutoMemEntrypoint,
  getAutoMemPath,
  hasAutoMemPathOverride,
  isAutoMemoryEnabled,
  isAutoMemPath,
} from './paths.js'

const ENV_KEYS = [
  'KNIGHTCODE_CONFIG_DIR',
  'KNIGHTCODE_REMOTE_MEMORY_DIR',
  'KNIGHTCODE_COWORK_MEMORY_PATH_OVERRIDE',
  'KNIGHTCODE_CODE_DISABLE_AUTO_MEMORY',
  'KNIGHTCODE_CODE_SIMPLE',
  'KNIGHTCODE_CODE_REMOTE',
] as const
const prev = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]))

const tmpConfigDir = mkdtempSync(join(tmpdir(), 'kc-memdir-'))
process.env.KNIGHTCODE_CONFIG_DIR = tmpConfigDir

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (prev[k] === undefined) delete process.env[k]
    else process.env[k] = prev[k]!
  }
  process.env.KNIGHTCODE_CONFIG_DIR = tmpConfigDir
}

afterEach(() => {
  // Reset any per-test env overrides and the projectRoot-keyed memo.
  delete process.env.KNIGHTCODE_COWORK_MEMORY_PATH_OVERRIDE
  delete process.env.KNIGHTCODE_CODE_DISABLE_AUTO_MEMORY
  delete process.env.KNIGHTCODE_CODE_SIMPLE
  delete process.env.KNIGHTCODE_CODE_REMOTE
  delete process.env.KNIGHTCODE_REMOTE_MEMORY_DIR
  getAutoMemPath.cache?.clear?.()
})

afterAll(() => {
  restoreEnv()
})

describe('isAutoMemoryEnabled', () => {
  test('enabled by default', () => {
    expect(isAutoMemoryEnabled()).toBe(true)
  })

  test('KNIGHTCODE_CODE_DISABLE_AUTO_MEMORY=1 disables it', () => {
    process.env.KNIGHTCODE_CODE_DISABLE_AUTO_MEMORY = '1'
    expect(isAutoMemoryEnabled()).toBe(false)
  })

  test('KNIGHTCODE_CODE_DISABLE_AUTO_MEMORY=0 force-enables it', () => {
    process.env.KNIGHTCODE_CODE_DISABLE_AUTO_MEMORY = '0'
    expect(isAutoMemoryEnabled()).toBe(true)
  })

  test('--bare / SIMPLE disables it', () => {
    process.env.KNIGHTCODE_CODE_SIMPLE = '1'
    expect(isAutoMemoryEnabled()).toBe(false)
  })

  test('remote without persistent storage disables it', () => {
    process.env.KNIGHTCODE_CODE_REMOTE = '1'
    expect(isAutoMemoryEnabled()).toBe(false)
  })
})

describe('getAutoMemPath / isAutoMemPath', () => {
  test('default path lives under <base>/projects/<sanitized>/memory/', () => {
    const p = getAutoMemPath()
    expect(p).toContain(join(tmpConfigDir, 'projects'))
    expect(p.endsWith('memory' + sep)).toBe(true)
  })

  test('entrypoint is MEMORY.md inside the auto-mem dir', () => {
    expect(getAutoMemEntrypoint().endsWith('MEMORY.md')).toBe(true)
  })

  test('isAutoMemPath matches files under the dir, rejects others + traversal', () => {
    const inside = getAutoMemEntrypoint()
    expect(isAutoMemPath(inside)).toBe(true)
    expect(isAutoMemPath(join(tmpConfigDir, 'unrelated.txt'))).toBe(false)
    expect(isAutoMemPath(join(getAutoMemPath(), '..', '..', 'escape.txt'))).toBe(
      false,
    )
  })

  test('a valid COWORK override path is used directly', () => {
    const override = mkdtempSync(join(tmpdir(), 'kc-mem-override-'))
    process.env.KNIGHTCODE_COWORK_MEMORY_PATH_OVERRIDE = override
    getAutoMemPath.cache?.clear?.()
    expect(hasAutoMemPathOverride()).toBe(true)
    expect(getAutoMemPath()).toBe((override + sep).normalize('NFC'))
  })

  test('a relative override path is rejected (falls back to default)', () => {
    process.env.KNIGHTCODE_COWORK_MEMORY_PATH_OVERRIDE = 'relative/dir'
    getAutoMemPath.cache?.clear?.()
    expect(hasAutoMemPathOverride()).toBe(false)
    expect(getAutoMemPath()).toContain(join(tmpConfigDir, 'projects'))
  })
})

describe('findRelevantMemories', () => {
  test('returns [] for an empty/absent memory dir without calling the model', async () => {
    const result = await findRelevantMemories(
      'some query',
      join(tmpConfigDir, 'does-not-exist'),
      new AbortController().signal,
    )
    expect(result).toEqual([])
  })
})
