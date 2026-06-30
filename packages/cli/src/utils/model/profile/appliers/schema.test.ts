import { describe, expect, test } from 'bun:test'
import { geminiEnumToString, moonshotStripRefSiblings } from './schema.js'

describe('geminiEnumToString', () => {
  test('converts integer enum values to strings and retypes to string', () => {
    const out = geminiEnumToString({
      type: 'object',
      properties: { level: { type: 'integer', enum: [1, 2, 3] } },
    })
    expect(out.properties.level.type).toBe('string')
    expect(out.properties.level.enum).toEqual(['1', '2', '3'])
  })
})

describe('moonshotStripRefSiblings', () => {
  test('drops sibling keywords next to $ref', () => {
    const out = moonshotStripRefSiblings({ $ref: '#/x', description: 'd', title: 't' })
    expect(out).toEqual({ $ref: '#/x' })
  })
})
