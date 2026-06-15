import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { getSessionMemoryPath } from '../../utils/permissions/filesystem.js'
import { getSessionMemoryContent } from './sessionMemoryUtils.js'

const memoryPath = getSessionMemoryPath()
const existedBefore = existsSync(memoryPath)

afterEach(() => {
  // Only remove the file we created; leave a pre-existing one untouched.
  if (!existedBefore && existsSync(memoryPath)) {
    rmSync(memoryPath, { force: true })
  }
})

describe('session memory content', () => {
  test('round-trips a written session-memory summary', async () => {
    const content = '# Session Memory\n\n- learned: the build uses bun\n'
    mkdirSync(dirname(memoryPath), { recursive: true })
    writeFileSync(memoryPath, content, 'utf-8')

    const read = await getSessionMemoryContent()
    expect(read).toBe(content)
  })

  test('returns null when no session memory file exists', async () => {
    // Don't disturb a pre-existing real session-memory file.
    if (existedBefore) return
    if (existsSync(memoryPath)) rmSync(memoryPath, { force: true })
    const read = await getSessionMemoryContent()
    expect(read).toBeNull()
  })
})
