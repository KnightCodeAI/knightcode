import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getAgentMemoryDir,
  getAgentMemoryEntrypoint,
  getMemoryScopeDisplay,
  isAgentMemoryPath,
} from './agentMemory.js'

const prevConfigDir = process.env.KNIGHTCODE_CONFIG_DIR
const prevRemote = process.env.KNIGHTCODE_REMOTE_MEMORY_DIR
const tmpConfigDir = mkdtempSync(join(tmpdir(), 'kc-agent-mem-'))
process.env.KNIGHTCODE_CONFIG_DIR = tmpConfigDir
delete process.env.KNIGHTCODE_REMOTE_MEMORY_DIR

afterAll(() => {
  if (prevConfigDir === undefined) delete process.env.KNIGHTCODE_CONFIG_DIR
  else process.env.KNIGHTCODE_CONFIG_DIR = prevConfigDir
  if (prevRemote !== undefined)
    process.env.KNIGHTCODE_REMOTE_MEMORY_DIR = prevRemote
})

describe('getAgentMemoryDir', () => {
  test('user scope lives under the memory base / agent-memory / <type>', () => {
    const dir = getAgentMemoryDir('reviewer', 'user')
    expect(dir).toContain(join('agent-memory', 'reviewer'))
    expect(dir).toContain(tmpConfigDir)
    expect(dir.endsWith('/') || dir.endsWith('\\')).toBe(true)
  })

  test('project scope is cwd-based under .knightcode/agent-memory', () => {
    const dir = getAgentMemoryDir('reviewer', 'project')
    expect(dir).toContain(join('.knightcode', 'agent-memory', 'reviewer'))
  })

  test('colons in plugin-namespaced agent types are sanitized to dashes', () => {
    const dir = getAgentMemoryDir('my-plugin:my-agent', 'user')
    expect(dir).toContain('my-plugin-my-agent')
    expect(dir).not.toContain('my-plugin:my-agent')
  })
})

describe('isAgentMemoryPath', () => {
  test('a file inside a user-scope agent-memory dir is recognized', () => {
    const file = getAgentMemoryEntrypoint('reviewer', 'user')
    expect(isAgentMemoryPath(file)).toBe(true)
  })

  test('a file inside a project-scope agent-memory dir is recognized', () => {
    const file = getAgentMemoryEntrypoint('reviewer', 'project')
    expect(isAgentMemoryPath(file)).toBe(true)
  })

  test('an unrelated path is not an agent-memory path', () => {
    expect(isAgentMemoryPath(join(tmpConfigDir, 'projects', 'x.jsonl'))).toBe(
      false,
    )
  })

  test('path traversal cannot smuggle in via .. segments', () => {
    const sneaky = join(
      tmpConfigDir,
      'agent-memory',
      'reviewer',
      '..',
      '..',
      'secrets.txt',
    )
    expect(isAgentMemoryPath(sneaky)).toBe(false)
  })
})

describe('getAgentMemoryEntrypoint', () => {
  test('points at MEMORY.md inside the scope dir', () => {
    const entry = getAgentMemoryEntrypoint('reviewer', 'user')
    expect(entry.endsWith('MEMORY.md')).toBe(true)
    expect(entry).toContain(join('agent-memory', 'reviewer'))
  })
})

describe('getMemoryScopeDisplay', () => {
  test('labels each scope, None when undefined', () => {
    expect(getMemoryScopeDisplay('user')).toContain('User')
    expect(getMemoryScopeDisplay('project')).toContain('Project')
    expect(getMemoryScopeDisplay('local')).toContain('Local')
    expect(getMemoryScopeDisplay(undefined)).toBe('None')
  })
})
