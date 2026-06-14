import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanMemoryFiles, formatMemoryManifest } from './memoryScan.js'

const dir = mkdtempSync(join(tmpdir(), 'knightcode-memdir-'))

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('memdir scan', () => {
  test('parses a memory file\'s frontmatter and round-trips it', async () => {
    writeFileSync(
      join(dir, 'shipped-p5.md'),
      [
        '---',
        'name: shipped-p5',
        'description: P5 ported the skills/hooks/commands subsystems',
        'type: project',
        '---',
        '',
        'The body.',
      ].join('\n'),
    )

    const headers = await scanMemoryFiles(dir, new AbortController().signal)
    expect(headers.length).toBe(1)
    expect(headers[0]!.description).toBe(
      'P5 ported the skills/hooks/commands subsystems',
    )
    expect(headers[0]!.type).toBe('project')

    const manifest = formatMemoryManifest(headers)
    expect(manifest).toContain('shipped-p5')
  })

  test('ignores the MEMORY.md index file', async () => {
    writeFileSync(join(dir, 'MEMORY.md'), '# Index\n')
    const headers = await scanMemoryFiles(dir, new AbortController().signal)
    expect(headers.every(h => !h.filename.endsWith('MEMORY.md'))).toBe(true)
  })
})
