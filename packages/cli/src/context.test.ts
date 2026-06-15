import { test, expect, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getUserContext, getSystemContext } from './context.js'
import { resetGetMemoryFilesCache } from './utils/claudemd.js'
import { getOriginalCwd, setOriginalCwd } from './bootstrap/state.js'

let dir: string
const savedCwd = getOriginalCwd()

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  setOriginalCwd(savedCwd)
  resetGetMemoryFilesCache()
  getUserContext.cache.clear?.()
  getSystemContext.cache.clear?.()
})

test('getUserContext returns memory content for a repo with CLAUDE.md', async () => {
  dir = mkdtempSync(join(tmpdir(), 'kc-ctx-'))
  writeFileSync(join(dir, 'CLAUDE.md'), 'remember the secret rule')
  setOriginalCwd(dir)
  resetGetMemoryFilesCache()
  getUserContext.cache.clear?.()
  const ctx = await getUserContext()
  expect(ctx.claudeMd).toContain('remember the secret rule')
  expect(ctx.currentDate).toContain("Today's date")
})

test('getSystemContext resolves to a context object', async () => {
  const sys = await getSystemContext()
  expect(typeof sys).toBe('object')
})
