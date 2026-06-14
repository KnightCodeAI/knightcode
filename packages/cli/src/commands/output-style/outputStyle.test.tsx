import { describe, expect, test } from 'bun:test'
import outputStyle from './index.js'
import { getOutputStyleDirStyles } from '../../outputStyles/loadOutputStylesDir.js'

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
    await mod.call(
      (result?: string) => {
        message = result ?? ''
      },
      {} as never,
      '',
    )
    expect(message).toContain('/config')
  })
})

describe('output style discovery', () => {
  test('loads the on-disk output styles without throwing', async () => {
    const styles = await getOutputStyleDirStyles(process.cwd())
    expect(Array.isArray(styles)).toBe(true)
  })
})
