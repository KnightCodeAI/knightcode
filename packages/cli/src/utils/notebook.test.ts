import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  mapNotebookCellsToToolResult,
  parseCellId,
  readNotebook,
} from './notebook.js'

const NOTEBOOK = {
  cells: [
    {
      cell_type: 'markdown',
      source: ['# Title\n', 'intro'],
      metadata: {},
    },
    {
      cell_type: 'code',
      source: 'print("hi")',
      execution_count: 1,
      metadata: {},
      outputs: [{ output_type: 'stream', text: 'hi\n' }],
    },
  ],
  metadata: { language_info: { name: 'python' } },
  nbformat: 4,
  nbformat_minor: 5,
}

function writeNotebook(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kc-nb-'))
  const path = join(dir, 'test.ipynb')
  writeFileSync(path, JSON.stringify(NOTEBOOK), 'utf-8')
  return path
}

describe('notebook reading', () => {
  test('readNotebook parses cells with type, source, and outputs', async () => {
    const cells = await readNotebook(writeNotebook())
    expect(cells).toHaveLength(2)
    expect(cells[0]?.cellType).toBe('markdown')
    expect(cells[0]?.source).toBe('# Title\nintro')
    expect(cells[1]?.cellType).toBe('code')
    expect(cells[1]?.source).toBe('print("hi")')
    expect(cells[1]?.outputs?.[0]?.text).toContain('hi')
  })

  test('mapNotebookCellsToToolResult renders cells into a tool_result', () => {
    const result = mapNotebookCellsToToolResult(
      [
        { cellType: 'markdown', source: 'hello', cell_id: 'cell-0' },
        { cellType: 'code', source: 'x = 1', language: 'python', cell_id: 'cell-1' },
      ],
      'tool-1',
    )
    expect(result.type).toBe('tool_result')
    expect(result.tool_use_id).toBe('tool-1')
    const content = result.content
    expect(Array.isArray(content)).toBe(true)
    const text = (content as { type: string; text?: string }[])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n')
    expect(text).toContain('hello')
    expect(text).toContain('x = 1')
  })

  test('parseCellId extracts the index, rejecting non-matching ids', () => {
    expect(parseCellId('cell-3')).toBe(3)
    expect(parseCellId('cell-abc')).toBeUndefined()
    expect(parseCellId('notacell')).toBeUndefined()
  })
})
