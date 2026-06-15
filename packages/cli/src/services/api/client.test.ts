import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearApiKeyHelperCache,
  getKnightcodeApiKey,
  getKnightcodeApiKeyWithSource,
  saveCredentials,
} from '../../utils/auth.js'
import { getKnightcodeClient, OPENROUTER_BASE_URL } from './client.js'

let configDir: string
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  savedEnv.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
  savedEnv.KNIGHTCODE_CONFIG_DIR = process.env.KNIGHTCODE_CONFIG_DIR
  savedEnv.OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL
  delete process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_BASE_URL
  configDir = mkdtempSync(join(tmpdir(), 'kc-auth-'))
  process.env.KNIGHTCODE_CONFIG_DIR = configDir
  clearApiKeyHelperCache()
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  rmSync(configDir, { recursive: true, force: true })
  clearApiKeyHelperCache()
})

describe('credential resolution', () => {
  test('no key anywhere resolves to none', () => {
    expect(getKnightcodeApiKeyWithSource()).toEqual({
      key: null,
      source: 'none',
    })
  })

  test('environment key wins and reports the env source', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test-env'
    saveCredentials('sk-or-test-file')
    clearApiKeyHelperCache()
    const { key, source } = getKnightcodeApiKeyWithSource()
    expect(key).toBe('sk-or-test-env')
    expect(source).toBe('OPENROUTER_API_KEY')
  })

  test('saved credentials resolve with the managed source', () => {
    saveCredentials('sk-or-test-file')
    const { key, source } = getKnightcodeApiKeyWithSource()
    expect(key).toBe('sk-or-test-file')
    expect(source).toBe('/login managed key')
  })

  test('saveCredentials writes the expected file shape', () => {
    saveCredentials('sk-or-test-file')
    const raw = JSON.parse(
      readFileSync(join(configDir, 'credentials.json'), 'utf8'),
    )
    expect(raw).toEqual({ openrouter: { apiKey: 'sk-or-test-file' } })
  })

  test('resolution is cached until cleared', () => {
    expect(getKnightcodeApiKey()).toBeNull()
    process.env.OPENROUTER_API_KEY = 'sk-or-late'
    expect(getKnightcodeApiKey()).toBeNull()
    clearApiKeyHelperCache()
    expect(getKnightcodeApiKey()).toBe('sk-or-late')
  })
})

describe('getKnightcodeClient', () => {
  test('targets the gateway base URL', async () => {
    const client = await getKnightcodeClient({ maxRetries: 0 })
    expect(client.baseURL).toBe(OPENROUTER_BASE_URL)
  })

  test('honors the base URL override', async () => {
    process.env.OPENROUTER_BASE_URL = 'http://localhost:9999/api'
    const client = await getKnightcodeClient({ maxRetries: 0 })
    expect(client.baseURL).toBe('http://localhost:9999/api')
  })

  test('explicit key overrides the resolved key', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-env'
    clearApiKeyHelperCache()
    const client = await getKnightcodeClient({
      apiKey: 'sk-or-explicit',
      maxRetries: 0,
    })
    expect(client.apiKey).toBe('sk-or-explicit')
  })
})
