import { describe, expect, test } from 'bun:test'
import theme from './theme/index.js'
import model from './model/index.js'

describe('theme command', () => {
  test('is a local-jsx command that lazy-loads a callable', async () => {
    expect(theme.name).toBe('theme')
    expect(theme.type).toBe('local-jsx')
    if (theme.type !== 'local-jsx') throw new Error('theme must be local-jsx')
    const mod = await theme.load()
    expect(typeof mod.call).toBe('function')
  })
})

describe('model command', () => {
  test('is an argument-hinted local-jsx command that lazy-loads a callable', async () => {
    expect(model.name).toBe('model')
    expect(model.type).toBe('local-jsx')
    expect(model.argumentHint).toBe('[model]')
    if (model.type !== 'local-jsx') throw new Error('model must be local-jsx')
    const mod = await model.load()
    expect(typeof mod.call).toBe('function')
  })
})
