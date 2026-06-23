import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { bashToolHasPermission } from './bashPermissions.js'

// checkPermissions reads only context.getAppState().toolPermissionContext.
function ctx(rules: { allow?: string[]; deny?: string[] }): ToolUseContext {
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    alwaysAllowRules: rules.allow?.length ? { session: rules.allow } : {},
    alwaysDenyRules: rules.deny?.length ? { session: rules.deny } : {},
  }
  return {
    getAppState: () => ({ toolPermissionContext }),
  } as unknown as ToolUseContext
}

async function behavior(
  command: string,
  rules: { allow?: string[]; deny?: string[] },
): Promise<string> {
  const result = await bashToolHasPermission({ command } as never, ctx(rules))
  return result.behavior
}

describe('bashToolHasPermission', () => {
  test('no rules -> ask', async () => {
    expect(await behavior('npm test', {})).toBe('ask')
  })

  test('exact allow rule allows the exact command', async () => {
    expect(await behavior('git status', { allow: ['Bash(git status)'] })).toBe(
      'allow',
    )
  })

  test('prefix allow rule allows the prefix and its args', async () => {
    expect(
      await behavior('npm test --watch', { allow: ['Bash(npm test:*)'] }),
    ).toBe('allow')
    expect(await behavior('npm test', { allow: ['Bash(npm test:*)'] })).toBe(
      'allow',
    )
  })

  test('prefix allow rule does NOT allow a different command', async () => {
    expect(await behavior('npm run build', { allow: ['Bash(npm test:*)'] })).toBe(
      'ask',
    )
  })

  test('wildcard allow rule matches', async () => {
    expect(await behavior('git add .', { allow: ['Bash(git *)'] })).toBe('allow')
  })

  // The security-critical property: an allow rule must never auto-approve a
  // command that chains/substitutes/redirects to something else.
  test('SECURITY: allow rule never auto-allows a chained/compound command', async () => {
    const allow = { allow: ['Bash(npm test:*)'] }
    expect(await behavior('npm test && rm -rf /', allow)).toBe('ask')
    expect(await behavior('npm test; rm -rf /', allow)).toBe('ask')
    expect(await behavior('npm test | tee out', allow)).toBe('ask')
    expect(await behavior('npm test $(whoami)', allow)).toBe('ask')
    expect(await behavior('npm test `whoami`', allow)).toBe('ask')
    expect(await behavior('npm test > /etc/passwd', allow)).toBe('ask')
  })

  test('deny rule blocks a matching command', async () => {
    expect(await behavior('rm -rf foo', { deny: ['Bash(rm:*)'] })).toBe('deny')
  })

  test('deny takes precedence over allow', async () => {
    expect(
      await behavior('git push', {
        allow: ['Bash(git:*)'],
        deny: ['Bash(git push:*)'],
      }),
    ).toBe('deny')
  })
})
