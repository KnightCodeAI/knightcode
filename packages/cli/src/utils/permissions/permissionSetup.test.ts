import { afterEach, describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { isAutoModeActive, setAutoModeActive } from './autoModeState.js'
import {
  isAutoModeGateEnabled,
  stripDangerousPermissionsForAutoMode,
  transitionPermissionMode,
  verifyAutoModeGateAccess,
} from './permissionSetup.js'

afterEach(() => setAutoModeActive(false))

describe('isAutoModeGateEnabled', () => {
  test('auto mode is always available in this BYOK build', () => {
    expect(isAutoModeGateEnabled()).toBe(true)
  })
})

describe('stripDangerousPermissionsForAutoMode', () => {
  test('removes blanket Bash/PowerShell allow rules', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        session: ['Bash', 'Bash(*)', 'Bash(git status:*)', 'PowerShell(*)'],
        userSettings: ['Read'],
      },
    }
    const next = stripDangerousPermissionsForAutoMode(ctx)
    expect(next.alwaysAllowRules.session).toEqual(['Bash(git status:*)'])
    expect(next.alwaysAllowRules.userSettings).toEqual(['Read'])
  })

  test('returns the same reference when nothing dangerous is present', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: { session: ['Bash(git status:*)', 'Read'] },
    }
    expect(stripDangerousPermissionsForAutoMode(ctx)).toBe(ctx)
  })
})

describe('transitionPermissionMode', () => {
  test('entering auto activates the classifier and strips blanket rules', () => {
    const ctx = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: { session: ['Bash(*)'] },
    }
    const next = transitionPermissionMode('default', 'auto', ctx)
    expect(isAutoModeActive()).toBe(true)
    expect(next.alwaysAllowRules.session).toEqual([])
  })

  test('leaving auto deactivates the classifier', () => {
    setAutoModeActive(true)
    transitionPermissionMode('auto', 'default', getEmptyToolPermissionContext())
    expect(isAutoModeActive()).toBe(false)
  })

  test('non-auto transitions leave state untouched', () => {
    const ctx = getEmptyToolPermissionContext()
    expect(transitionPermissionMode('default', 'plan', ctx)).toBe(ctx)
    expect(isAutoModeActive()).toBe(false)
  })
})

describe('verifyAutoModeGateAccess', () => {
  test('marks auto mode available on the context', async () => {
    const { updateContext, notification } = await verifyAutoModeGateAccess(
      getEmptyToolPermissionContext(),
    )
    const next = updateContext(getEmptyToolPermissionContext())
    expect(next.isAutoModeAvailable).toBe(true)
    expect(notification).toBeNull()
  })
})
