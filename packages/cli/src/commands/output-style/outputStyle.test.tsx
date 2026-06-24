import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import outputStyle from './index.js'
import {
  clearOutputStyleCaches,
  getOutputStyleDirStyles,
} from '../../outputStyles/loadOutputStylesDir.js'

describe('/output-style command', () => {
  test('is a hidden local-jsx command', () => {
    expect(outputStyle.name).toBe('output-style')
    expect(outputStyle.type).toBe('local-jsx')
    expect(outputStyle.isHidden).toBe(true)
  })

  test('call points users to /config (output-style is deprecated)', async () => {
    if (outputStyle.type !== 'local-jsx') throw new Error('must be local-jsx')
    const mod = await outputStyle.load()
    let message = ''
    await (mod.call as (onDone: (result?: string) => void) => Promise<unknown>)(
      (result?: string) => {
        message = result ?? ''
      },
    )
    expect(message).toContain('/config')
  })
})

describe('output style discovery', () => {
  test('loads the on-disk output styles without throwing', async () => {
    const styles = await getOutputStyleDirStyles(process.cwd())
    expect(Array.isArray(styles)).toBe(true)
  })

  test('discovers a project .knightcode/output-styles markdown file', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'kc-outstyle-'))
    try {
      const stylesDir = join(projectDir, '.knightcode', 'output-styles')
      mkdirSync(stylesDir, { recursive: true })
      writeFileSync(
        join(stylesDir, 'terse.md'),
        `---
name: Terse
description: Answer in as few words as possible
---

Be extremely terse. One sentence answers only.
`,
      )

      clearOutputStyleCaches()
      const styles = await getOutputStyleDirStyles(projectDir)
      const terse = styles.find(s => s.name === 'Terse')
      expect(terse).toBeDefined()
      expect(terse?.description).toBe('Answer in as few words as possible')
      expect(terse?.prompt).toContain('extremely terse')
      expect(terse?.source).toBe('projectSettings')
    } finally {
      clearOutputStyleCaches()
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
