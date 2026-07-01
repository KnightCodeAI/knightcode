import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { languageIdForFile } from './languageIds.js'
import { resolveProjectRoot, resolveServerForFile } from './serverRegistry.js'

describe('resolveServerForFile', () => {
  test('maps TypeScript/JavaScript extensions to the typescript server', () => {
    for (const ext of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.cjs']) {
      expect(resolveServerForFile(`/x/file${ext}`)?.id).toBe('typescript')
    }
  })

  test('maps language-specific extensions to their servers', () => {
    expect(resolveServerForFile('/x/a.py')?.id).toBe('pyright')
    expect(resolveServerForFile('/x/a.pyi')?.id).toBe('pyright')
    expect(resolveServerForFile('/x/a.go')?.id).toBe('gopls')
    expect(resolveServerForFile('/x/a.rs')?.id).toBe('rust-analyzer')
  })

  test('is case-insensitive on the extension', () => {
    expect(resolveServerForFile('/x/A.TS')?.id).toBe('typescript')
  })

  test('returns undefined for unsupported or extensionless files', () => {
    expect(resolveServerForFile('/x/a.md')).toBeUndefined()
    expect(resolveServerForFile('/x/Makefile')).toBeUndefined()
  })
})

describe('languageIdForFile', () => {
  test('returns LSP language ids for known extensions', () => {
    expect(languageIdForFile('a.ts')).toBe('typescript')
    expect(languageIdForFile('a.tsx')).toBe('typescriptreact')
    expect(languageIdForFile('a.js')).toBe('javascript')
    expect(languageIdForFile('a.py')).toBe('python')
    expect(languageIdForFile('a.go')).toBe('go')
    expect(languageIdForFile('a.rs')).toBe('rust')
  })

  test('falls back to plaintext for unknown extensions', () => {
    expect(languageIdForFile('a.md')).toBe('plaintext')
  })
})

describe('resolveProjectRoot', () => {
  const ts = resolveServerForFile('/x/a.ts')!

  test('walks up to the nearest directory containing a root marker', () => {
    const base = mkdtempSync(join(tmpdir(), 'lsp-root-'))
    try {
      const projectRoot = join(base, 'project')
      const nested = join(projectRoot, 'src', 'deep')
      mkdirSync(nested, { recursive: true })
      writeFileSync(join(projectRoot, 'tsconfig.json'), '{}')
      const filePath = join(nested, 'file.ts')
      expect(resolveProjectRoot(filePath, ts, base)).toBe(projectRoot)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test('falls back to the provided cwd when no marker is found', () => {
    const base = mkdtempSync(join(tmpdir(), 'lsp-noroot-'))
    try {
      const nested = join(base, 'a', 'b')
      mkdirSync(nested, { recursive: true })
      const filePath = join(nested, 'file.ts')
      const fallback = '/fallback/cwd'
      // Use a marker that cannot exist anywhere on the path so the walk-up
      // never matches a real package.json in an OS-temp ancestor.
      const neverMatches = {
        ...ts,
        rootMarkers: ['__lsp_test_marker_that_does_not_exist__.xyz'],
      }
      expect(resolveProjectRoot(filePath, neverMatches, fallback)).toBe(
        fallback,
      )
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
