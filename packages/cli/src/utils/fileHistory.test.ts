import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID, type UUID } from 'crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { regenerateSessionId, setIsInteractive } from '../bootstrap/state.js'
import {
  fileHistoryCanRestore,
  fileHistoryEnabled,
  fileHistoryMakeSnapshot,
  fileHistoryRewind,
  fileHistoryTrackEdit,
  type FileHistoryState,
} from './fileHistory.js'

const prevConfigDir = process.env.KNIGHTCODE_CONFIG_DIR

function restoreEnv(): void {
  if (prevConfigDir === undefined) delete process.env.KNIGHTCODE_CONFIG_DIR
  else process.env.KNIGHTCODE_CONFIG_DIR = prevConfigDir
  setIsInteractive(false)
}

describe('file history track → snapshot → rewind', () => {
  let tmpConfigDir: string
  let workDir: string

  beforeEach(() => {
    tmpConfigDir = mkdtempSync(join(tmpdir(), 'kc-fh-cfg-'))
    workDir = mkdtempSync(join(tmpdir(), 'kc-fh-work-'))
    process.env.KNIGHTCODE_CONFIG_DIR = tmpConfigDir
    // fileHistoryEnabled() uses the SDK gate in non-interactive sessions; flip
    // to interactive so the default (checkpointing on) applies.
    setIsInteractive(true)
    regenerateSessionId() // fresh per-session backup dir
  })
  afterEach(restoreEnv)
  afterAll(restoreEnv)

  test('is enabled in an interactive session by default', () => {
    expect(fileHistoryEnabled()).toBe(true)
  })

  test('rewinds a file to its pre-edit content', async () => {
    const m0 = randomUUID() as UUID
    const m1 = randomUUID() as UUID
    const filePath = join(workDir, 'target.txt')
    writeFileSync(filePath, 'original\n')

    // Seed an initial (empty) snapshot at m0, the baseline rewind point.
    let state: FileHistoryState = {
      snapshots: [
        { messageId: m0, trackedFileBackups: {}, timestamp: new Date() },
      ],
      trackedFiles: new Set(),
      snapshotSequence: 0,
    }
    const update = (updater: (prev: FileHistoryState) => FileHistoryState) => {
      state = updater(state)
    }

    // Before editing, track the file — backs up "original" as v1 into m0.
    await fileHistoryTrackEdit(update, filePath, m0)
    expect(state.trackedFiles.size).toBe(1)

    // The edit happens, then a turn-boundary snapshot captures "edited" as v2.
    writeFileSync(filePath, 'edited\n')
    await fileHistoryMakeSnapshot(update, m1)

    expect(fileHistoryCanRestore(state, m0)).toBe(true)

    // A further edit, then rewinding to the m0 baseline restores "original".
    writeFileSync(filePath, 'more edits\n')
    await fileHistoryRewind(update, m0)
    expect(readFileSync(filePath, 'utf8')).toBe('original\n')

    // Rewinding to m1 restores the post-edit content.
    await fileHistoryRewind(update, m1)
    expect(readFileSync(filePath, 'utf8')).toBe('edited\n')
  })

  test('rewind restores a file that was deleted after the snapshot', async () => {
    const m0 = randomUUID() as UUID
    const filePath = join(workDir, 'kept.txt')
    writeFileSync(filePath, 'keep me\n')

    let state: FileHistoryState = {
      snapshots: [
        { messageId: m0, trackedFileBackups: {}, timestamp: new Date() },
      ],
      trackedFiles: new Set(),
      snapshotSequence: 0,
    }
    const update = (updater: (prev: FileHistoryState) => FileHistoryState) => {
      state = updater(state)
    }

    await fileHistoryTrackEdit(update, filePath, m0)
    // Simulate the file being removed, then rewind — it should be restored.
    writeFileSync(filePath, 'changed\n')
    await fileHistoryRewind(update, m0)
    expect(readFileSync(filePath, 'utf8')).toBe('keep me\n')
  })
})
