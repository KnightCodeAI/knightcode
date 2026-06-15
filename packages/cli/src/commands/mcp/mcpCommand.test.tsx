import { describe, expect, test } from 'bun:test'
import React from 'react'
import mcp from './index.js'

describe('/mcp command', () => {
  test('is a dialog-backed command named mcp', () => {
    expect(mcp.type).toBe('local-jsx')
    expect(mcp.name).toBe('mcp')
  })

  test('produces the MCP settings dialog element', async () => {
    const mod = await mcp.load()
    const element = await mod.call(() => {}, undefined as never, undefined)
    expect(React.isValidElement(element)).toBe(true)
  })
})
