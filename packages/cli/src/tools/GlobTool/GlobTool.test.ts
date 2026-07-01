import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { GlobTool } from './GlobTool.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'knightcode-glob-'))
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src', 'alpha.ts'), 'export const a = 1\n')
  writeFileSync(join(dir, 'src', 'beta.ts'), 'export const b = 2\n')
  writeFileSync(join(dir, 'readme.md'), '# readme\n')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

// GlobTool.call only reads these fields off the context.
function ctx(): ToolUseContext {
  return {
    abortController: new AbortController(),
    getAppState: () => ({
      toolPermissionContext: getEmptyToolPermissionContext(),
    }),
    globLimits: { maxResults: 100 },
  } as unknown as ToolUseContext
}

describe('GlobTool.call', () => {
  test('matches files by pattern under a directory', async () => {
    const result = await GlobTool.call(
      { pattern: '**/*.ts', path: dir },
      ctx(),
    )
    const names = result.data.filenames.map(f => f.replace(/\\/g, '/'))
    expect(result.data.numFiles).toBe(2)
    expect(names.some(n => n.endsWith('src/alpha.ts'))).toBe(true)
    expect(names.some(n => n.endsWith('src/beta.ts'))).toBe(true)
    expect(names.some(n => n.endsWith('readme.md'))).toBe(false)
  })

  test('returns no files for a non-matching pattern', async () => {
    const result = await GlobTool.call(
      { pattern: '**/*.py', path: dir },
      ctx(),
    )
    expect(result.data.numFiles).toBe(0)
  })
})

describe('GlobTool.call gitignore handling', () => {
  let gdir: string

  beforeAll(() => {
    gdir = mkdtempSync(join(tmpdir(), 'knightcode-glob-gi-'))
    // ripgrep only applies .gitignore rules inside a git repo, so mark this
    // temp dir as one. An empty .git directory is enough for the heuristic.
    mkdirSync(join(gdir, '.git'), { recursive: true })
    mkdirSync(join(gdir, 'node_modules', 'pkg'), { recursive: true })
    mkdirSync(join(gdir, 'src'), { recursive: true })
    writeFileSync(join(gdir, '.gitignore'), 'node_modules/\n')
    writeFileSync(join(gdir, 'src', 'app.ts'), 'export const x = 1\n')
    writeFileSync(
      join(gdir, 'node_modules', 'pkg', 'index.ts'),
      'export const y = 2\n',
    )
  })

  afterAll(() => {
    rmSync(gdir, { recursive: true, force: true })
  })

  test('excludes gitignored files by default', async () => {
    const result = await GlobTool.call(
      { pattern: '**/*.ts', path: gdir },
      ctx(),
    )
    const names = result.data.filenames.map(f => f.replace(/\\/g, '/'))
    expect(names.some(n => n.endsWith('src/app.ts'))).toBe(true)
    expect(names.some(n => n.includes('node_modules'))).toBe(false)
  })
})
