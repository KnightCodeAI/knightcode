import { describe, expect, test } from 'bun:test'
import { NotebookEditTool } from './NotebookEditTool.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from './constants.js'
import { renderToolUseMessage } from './UI.js'

describe('NotebookEditTool', () => {
  test('name matches the reference NotebookEdit tool name', () => {
    expect(NotebookEditTool.name).toBe(NOTEBOOK_EDIT_TOOL_NAME)
    expect(NotebookEditTool.name).toBe('NotebookEdit')
  })

  test('renders a tool-use summary for a sample edit input', () => {
    const node = renderToolUseMessage(
      {
        notebook_path: '/tmp/example.ipynb',
        cell_id: '0',
        new_source: "print('hi')",
        cell_type: 'code',
        edit_mode: 'replace',
      },
      { verbose: true },
    )
    expect(node).not.toBeNull()
  })

  test('returns null when required fields are missing', () => {
    const node = renderToolUseMessage({}, { verbose: false })
    expect(node).toBeNull()
  })
})
