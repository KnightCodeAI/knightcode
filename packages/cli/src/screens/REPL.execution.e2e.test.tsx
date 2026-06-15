import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../Tool'
import { getTools } from '../tools'

// End-to-end gate for the gap-closing execution work: the sub-agent (Agent),
// shell (Bash), Notebook, and Skill tools are reinstated into the real tool
// pool alongside the file suite, over the production getTools() path the REPL
// and runAgent both assemble from.

describe('execution tool pool', () => {
  test('the reinstated execution tools are present alongside the file suite', () => {
    const names = new Set(getTools(getEmptyToolPermissionContext()).map(t => t.name))

    // Reinstated by the gap-closing work.
    expect(names.has('Agent')).toBe(true)
    expect(names.has('Bash')).toBe(true)
    expect(names.has('NotebookEdit')).toBe(true)
    expect(names.has('Skill')).toBe(true)

    // The pre-existing file/search suite is still there.
    expect(names.has('Read')).toBe(true)
    expect(names.has('Edit')).toBe(true)
    expect(names.has('Write')).toBe(true)
    expect(names.has('Glob')).toBe(true)
    expect(names.has('Grep')).toBe(true)
    expect(names.has('TodoWrite')).toBe(true)
  })
})
