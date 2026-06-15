import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getMemoryFiles, resetGetMemoryFilesCache } from './claudemd.js'
import { getOriginalCwd, setOriginalCwd } from '../bootstrap/state.js'

let dir: string
const savedCwd = getOriginalCwd()

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  setOriginalCwd(savedCwd)
  resetGetMemoryFilesCache()
})

test('discovers CLAUDE.md at the project root', async () => {
  dir = mkdtempSync(join(tmpdir(), 'kc-mem-'))
  writeFileSync(join(dir, 'CLAUDE.md'), '# root memory\nproject rule one')
  setOriginalCwd(dir)
  resetGetMemoryFilesCache()
  const files = await getMemoryFiles()
  expect(files.some(f => f.content.includes('project rule one'))).toBe(true)
})
