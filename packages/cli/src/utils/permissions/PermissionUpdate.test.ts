import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import {
  applyPermissionUpdate,
  applyPermissionUpdates,
} from './PermissionUpdate.js'

describe('applyPermissionUpdate', () => {
  test('setMode switches the permission mode and preserves the rest', () => {
    const ctx = getEmptyToolPermissionContext()
    const next = applyPermissionUpdate(ctx, {
      type: 'setMode',
      mode: 'plan',
      destination: 'session',
    })
    expect(next.mode).toBe('plan')
    // Other fields are carried through unchanged.
    expect(next.alwaysAllowRules).toBe(ctx.alwaysAllowRules)
    expect(next.additionalWorkingDirectories).toBe(
      ctx.additionalWorkingDirectories,
    )
  })

  test('addRules appends to the matching behavior bucket and source', () => {
    const ctx = getEmptyToolPermissionContext()
    const next = applyPermissionUpdate(ctx, {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'git *' }],
      behavior: 'allow',
      destination: 'session',
    })
    expect(next.alwaysAllowRules.session).toEqual(['Bash(git *)'])
    // Deny/ask buckets untouched.
    expect(next.alwaysDenyRules.session ?? []).toEqual([])
  })

  test('addRules with deny behavior targets alwaysDenyRules', () => {
    const ctx = getEmptyToolPermissionContext()
    const next = applyPermissionUpdate(ctx, {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'rm *' }],
      behavior: 'deny',
      destination: 'session',
    })
    expect(next.alwaysDenyRules.session).toEqual(['Bash(rm *)'])
    expect(next.alwaysAllowRules.session ?? []).toEqual([])
  })

  test('removeRules filters out the named rule from the bucket', () => {
    const ctx = applyPermissionUpdate(getEmptyToolPermissionContext(), {
      type: 'addRules',
      rules: [
        { toolName: 'Bash', ruleContent: 'git *' },
        { toolName: 'Bash', ruleContent: 'ls *' },
      ],
      behavior: 'allow',
      destination: 'session',
    })
    const next = applyPermissionUpdate(ctx, {
      type: 'removeRules',
      rules: [{ toolName: 'Bash', ruleContent: 'git *' }],
      behavior: 'allow',
      destination: 'session',
    })
    expect(next.alwaysAllowRules.session).toEqual(['Bash(ls *)'])
  })

  test('replaceRules overwrites all rules for the source', () => {
    const ctx = applyPermissionUpdate(getEmptyToolPermissionContext(), {
      type: 'addRules',
      rules: [{ toolName: 'Bash', ruleContent: 'git *' }],
      behavior: 'allow',
      destination: 'session',
    })
    const next = applyPermissionUpdate(ctx, {
      type: 'replaceRules',
      rules: [{ toolName: 'Read', ruleContent: '/tmp/**' }],
      behavior: 'allow',
      destination: 'session',
    })
    expect(next.alwaysAllowRules.session).toEqual(['Read(/tmp/**)'])
  })

  test('addDirectories / removeDirectories mutate the working-dir map', () => {
    const added = applyPermissionUpdate(getEmptyToolPermissionContext(), {
      type: 'addDirectories',
      directories: ['/work/dir'],
      destination: 'session',
    })
    expect(added.additionalWorkingDirectories.get('/work/dir')).toEqual({
      path: '/work/dir',
      source: 'session',
    })
    const removed = applyPermissionUpdate(added, {
      type: 'removeDirectories',
      directories: ['/work/dir'],
      destination: 'session',
    })
    expect(removed.additionalWorkingDirectories.has('/work/dir')).toBe(false)
  })

  test('applyPermissionUpdates folds a sequence in order', () => {
    const next = applyPermissionUpdates(getEmptyToolPermissionContext(), [
      { type: 'setMode', mode: 'plan', destination: 'session' },
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash', ruleContent: 'git *' }],
        behavior: 'allow',
        destination: 'session',
      },
    ])
    expect(next.mode).toBe('plan')
    expect(next.alwaysAllowRules.session).toEqual(['Bash(git *)'])
  })
})
