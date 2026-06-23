import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
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

const tmpConfigDir = mkdtempSync(join(tmpdir(), 'kc-session-store-'))

function restoreEnv(): void {
  if (prevConfigDir === undefined) delete process.env.KNIGHTCODE_CONFIG_DIR
  else process.env.KNIGHTCODE_CONFIG_DIR = prevConfigDir
  if (prevTestPersist === undefined)
    delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
  else process.env.TEST_ENABLE_SESSION_PERSISTENCE = prevTestPersist
}

beforeEach(() => {
  // Point session storage at a throwaway config dir and allow writes in the
  // test env (shouldSkipPersistence otherwise suppresses transcript writes when
  // NODE_ENV=test). Scoped per-test (not module-global) so this test never
  // enables persistence for the rest of the suite — other tests fire-and-forget
  // `void recordTranscript(...)` on the shared Project singleton and would
  // otherwise leak writes into the real config dir (and occasionally into this
  // test's own transcript file, since the sessionId is process-global).
  process.env.KNIGHTCODE_CONFIG_DIR = tmpConfigDir
  process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'

  // Fresh session id per test → its own transcript file on disk.
  regenerateSessionId()
  resetProjectForTesting()
  clearSessionMessagesCache()
})

afterEach(() => {
  restoreEnv()
})

afterAll(() => {
  restoreEnv()
})

describe('transcript record → load round-trip', () => {
  test('records messages to JSONL and reads them back into a chain', async () => {
    const u1 = createUserMessage({ content: 'first user prompt' })
    const a1 = createAssistantMessage({ content: 'assistant reply' })
    const u2 = createUserMessage({ content: 'second user prompt' })
    const ourUuids = new Set<string>([u1.uuid, a1.uuid, u2.uuid])

    await recordTranscript([u1, a1, u2])
    await flushSessionStorage()

    // The file contains our three messages as JSONL lines. The Project singleton
    // and sessionId are process-global, so other suites can occasionally append
    // their own fire-and-forget transcript writes to this file — assert about
    // OUR messages by uuid rather than the raw total line count.
    const path = getTranscriptPath()
    const raw = readFileSync(path, 'utf8')
    const ourLines = raw
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
      .filter(o => (o.type === 'user' || o.type === 'assistant') && ourUuids.has(o.uuid))
    expect(ourLines).toHaveLength(3)

    // Reading back reconstructs OUR parentUuid chain in order. Foreign messages,
    // if any, only ever precede u1 (they were the file's leaf when u1 was
    // chained), so our three are the contiguous tail ending at the u2 leaf.
    const { messages } = await loadTranscriptFile(path)
    const leaf = messages.get(u2.uuid as UUID)
    expect(leaf).toBeDefined()
    const chain = buildConversationChain(messages, leaf!)
    expect(chain.slice(-3).map(m => m.uuid)).toEqual([u1.uuid, a1.uuid, u2.uuid])
  })

  test('appended turns extend the same transcript file', async () => {
    const u1 = createUserMessage({ content: 'turn one' })
    await recordTranscript([u1])
    const a1 = createAssistantMessage({ content: 'answer one' })
    await recordTranscript([u1, a1])
    await flushSessionStorage()

    // u1 is recorded once (dedup by uuid), a1 added on the second call.
    const path = getTranscriptPath()
    const raw = readFileSync(path, 'utf8')
    const rawLines = raw.split('\n').filter(Boolean).map(l => JSON.parse(l))
    const u1Count = rawLines.filter(o => o.uuid === u1.uuid).length
    expect(u1Count).toBe(1)

    const { messages } = await loadTranscriptFile(path)
    expect(messages.has(u1.uuid as UUID)).toBe(true)
    expect(messages.has(a1.uuid as UUID)).toBe(true)
    // a1 chains directly off u1 regardless of any foreign prefix in the file.
    const a1Loaded = messages.get(a1.uuid as UUID)!
    expect(a1Loaded.parentUuid).toBe(u1.uuid as UUID)
  })
})
