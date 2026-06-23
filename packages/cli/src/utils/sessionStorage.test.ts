import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UUID } from 'crypto'
import { regenerateSessionId } from '../bootstrap/state.js'
import { createAssistantMessage, createUserMessage } from './messages.js'
import {
  buildConversationChain,
  clearSessionMessagesCache,
  flushSessionStorage,
  getTranscriptPath,
  loadTranscriptFile,
  recordTranscript,
  resetProjectForTesting,
} from './sessionStorage.js'

const prevConfigDir = process.env.KNIGHTCODE_CONFIG_DIR
const prevTestPersist = process.env.TEST_ENABLE_SESSION_PERSISTENCE

// Point session storage at a throwaway config dir and allow writes in the
// test env (shouldSkipPersistence otherwise suppresses all transcript writes
// when NODE_ENV=test).
const tmpConfigDir = mkdtempSync(join(tmpdir(), 'kc-session-store-'))
process.env.KNIGHTCODE_CONFIG_DIR = tmpConfigDir
process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'

afterAll(() => {
  if (prevConfigDir === undefined) delete process.env.KNIGHTCODE_CONFIG_DIR
  else process.env.KNIGHTCODE_CONFIG_DIR = prevConfigDir
  if (prevTestPersist === undefined)
    delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
  else process.env.TEST_ENABLE_SESSION_PERSISTENCE = prevTestPersist
})

beforeEach(() => {
  // Fresh session id per test → its own transcript file on disk.
  regenerateSessionId()
  resetProjectForTesting()
  clearSessionMessagesCache()
})

describe('transcript record → load round-trip', () => {
  test('records messages to JSONL and reads them back into a chain', async () => {
    const u1 = createUserMessage({ content: 'first user prompt' })
    const a1 = createAssistantMessage({ content: 'assistant reply' })
    const u2 = createUserMessage({ content: 'second user prompt' })

    await recordTranscript([u1, a1, u2])
    await flushSessionStorage()

    // Raw file contains the three messages as JSONL lines.
    const path = getTranscriptPath()
    const raw = readFileSync(path, 'utf8')
    const lines = raw.split('\n').filter(Boolean)
    const transcriptLines = lines.filter(l => {
      const t = JSON.parse(l).type
      return t === 'user' || t === 'assistant'
    })
    expect(transcriptLines).toHaveLength(3)

    // Reading back reconstructs the parentUuid chain in order.
    const { messages, leafUuids } = await loadTranscriptFile(path)
    expect(messages.size).toBe(3)

    const leaf = messages.get([...leafUuids][0] as UUID)!
    expect(leaf).toBeDefined()
    const chain = buildConversationChain(messages, leaf)
    expect(chain.map(m => m.uuid)).toEqual([u1.uuid, a1.uuid, u2.uuid])
  })

  test('appended turns extend the same transcript file', async () => {
    const u1 = createUserMessage({ content: 'turn one' })
    await recordTranscript([u1])
    const a1 = createAssistantMessage({ content: 'answer one' })
    await recordTranscript([u1, a1])
    await flushSessionStorage()

    const { messages } = await loadTranscriptFile(getTranscriptPath())
    // u1 is recorded once (dedup by uuid), a1 added on the second call.
    expect(messages.size).toBe(2)
    expect(messages.has(u1.uuid as UUID)).toBe(true)
    expect(messages.has(a1.uuid as UUID)).toBe(true)
  })
})
