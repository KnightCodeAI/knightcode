import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
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

async function memoryFilesIn(root: string) {
  setOriginalCwd(root)
  resetGetMemoryFilesCache()
  return getMemoryFiles()
}

test('discovers KNIGHTCODE.md at the project root', async () => {
  dir = mkdtempSync(join(tmpdir(), 'kc-mem-'))
  writeFileSync(join(dir, 'KNIGHTCODE.md'), '# root memory\nproject rule one')
  const files = await memoryFilesIn(dir)
  expect(files.some(f => f.content.includes('project rule one'))).toBe(true)
})

test('ignores a legacy CLAUDE.md when no KNIGHTCODE.md is present', async () => {
  dir = mkdtempSync(join(tmpdir(), 'kc-mem-'))
  writeFileSync(join(dir, 'CLAUDE.md'), 'legacy should be ignored')
  const files = await memoryFilesIn(dir)
  expect(files.some(f => f.content.includes('legacy should be ignored'))).toBe(
    false,
  )
})

test('discovers a nested KNIGHTCODE.md and the parent root rule', async () => {
  dir = mkdtempSync(join(tmpdir(), 'kc-mem-'))
  writeFileSync(join(dir, 'KNIGHTCODE.md'), 'root rule')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'KNIGHTCODE.md'), 'nested rule')
  const files = await memoryFilesIn(join(dir, 'sub'))
  const blob = files.map(f => f.content).join('\n')
  expect(blob).toContain('root rule')
  expect(blob).toContain('nested rule')
})
