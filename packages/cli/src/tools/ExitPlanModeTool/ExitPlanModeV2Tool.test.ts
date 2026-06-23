import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { ExitPlanModeV2Tool } from './ExitPlanModeV2Tool.js'

function buildCtx(mode: 'default' | 'plan') {
  return { ...getEmptyToolPermissionContext(), mode }
}

function makeValidateArgs(mode: 'default' | 'plan') {
  return {
    getAppState: () => ({ toolPermissionContext: buildCtx(mode) }),
    options: { mainLoopModel: 'test-model' },
  }
}

describe('ExitPlanModeV2Tool.validateInput', () => {
  test('rejects when not in plan mode', async () => {
    const result = await ExitPlanModeV2Tool.validateInput!(
      {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeValidateArgs('default') as any,
    )
    expect(result.result).toBe(false)
    if (result.result === false) {
      expect(result.message).toContain('not in plan mode')
    }
  })

  test('accepts when in plan mode', async () => {
    const result = await ExitPlanModeV2Tool.validateInput!(
      {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeValidateArgs('plan') as any,
    )
    expect(result.result).toBe(true)
  })
})

describe('ExitPlanModeV2Tool.checkPermissions', () => {
  test('asks the user to confirm exiting plan mode (non-teammate)', async () => {
    const decision = await ExitPlanModeV2Tool.checkPermissions!(
      {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
    )
    expect(decision.behavior).toBe('ask')
  })
})
