import { describe, expect, test } from 'bun:test'
import { buildHeadlessPermissionContext } from './headlessPermissions.js'

describe('buildHeadlessPermissionContext', () => {
  test('dangerouslySkipPermissions maps to bypassPermissions mode', () => {
    const ctx = buildHeadlessPermissionContext({
      dangerouslySkipPermissions: true,
      allowedTools: [],
      disallowedTools: [],
    })
    expect(ctx.mode).toBe('bypassPermissions')
  })

  test('bypass flag wins even when an explicit permissionMode is also set', () => {
    const ctx = buildHeadlessPermissionContext({
      permissionMode: 'plan',
      dangerouslySkipPermissions: true,
      allowedTools: [],
      disallowedTools: [],
    })
    expect(ctx.mode).toBe('bypassPermissions')
  })

  test('explicit permissionMode is used when bypass is not set', () => {
    const ctx = buildHeadlessPermissionContext({
      permissionMode: 'plan',
      dangerouslySkipPermissions: false,
      allowedTools: [],
      disallowedTools: [],
    })
    expect(ctx.mode).toBe('plan')
  })

  test('defaults to default mode when nothing is specified', () => {
    const ctx = buildHeadlessPermissionContext({
      dangerouslySkipPermissions: false,
      allowedTools: [],
      disallowedTools: [],
    })
    expect(ctx.mode).toBe('default')
  })

  test('allowedTools land under alwaysAllowRules.cliArg', () => {
    const ctx = buildHeadlessPermissionContext({
      dangerouslySkipPermissions: false,
      allowedTools: ['Bash(npm run:*)', 'Read'],
      disallowedTools: [],
    })
    expect(ctx.alwaysAllowRules.cliArg).toEqual(['Bash(npm run:*)', 'Read'])
  })

  test('disallowedTools land under alwaysDenyRules.cliArg', () => {
    const ctx = buildHeadlessPermissionContext({
      dangerouslySkipPermissions: false,
      allowedTools: [],
      disallowedTools: ['Bash(rm:*)'],
    })
    expect(ctx.alwaysDenyRules.cliArg).toEqual(['Bash(rm:*)'])
  })

  test('empty allowedTools/disallowedTools arrays add no cliArg rules', () => {
    const ctx = buildHeadlessPermissionContext({
      dangerouslySkipPermissions: false,
      allowedTools: [],
      disallowedTools: [],
    })
    expect(ctx.alwaysAllowRules.cliArg).toBeUndefined()
    expect(ctx.alwaysDenyRules.cliArg).toBeUndefined()
  })

  test('starts from the empty context: unrelated fields keep their defaults', () => {
    const ctx = buildHeadlessPermissionContext({
      dangerouslySkipPermissions: false,
      allowedTools: [],
      disallowedTools: [],
    })
    expect(ctx.additionalWorkingDirectories.size).toBe(0)
    expect(ctx.isBypassPermissionsModeAvailable).toBe(false)
    expect(ctx.alwaysAskRules).toEqual({})
  })

  test('allow and deny rules can be set together independently', () => {
    const ctx = buildHeadlessPermissionContext({
      dangerouslySkipPermissions: false,
      allowedTools: ['Read'],
      disallowedTools: ['Write'],
    })
    expect(ctx.alwaysAllowRules.cliArg).toEqual(['Read'])
    expect(ctx.alwaysDenyRules.cliArg).toEqual(['Write'])
  })
})
