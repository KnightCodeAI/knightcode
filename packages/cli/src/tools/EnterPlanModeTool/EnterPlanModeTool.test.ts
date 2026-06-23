import { describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../Tool.js'
import { EnterPlanModeTool } from './EnterPlanModeTool.js'

function makeContext(agentId?: string) {
  let state: { toolPermissionContext: ReturnType<typeof buildCtx> } = {
    toolPermissionContext: buildCtx('default'),
  }
  return {
    agentId,
    getAppState: () => state,
    setAppState: (updater: (prev: typeof state) => typeof state) => {
      state = updater(state)
    },
    getState: () => state,
  }
}

function buildCtx(mode: 'default' | 'plan') {
  return { ...getEmptyToolPermissionContext(), mode }
}

describe('EnterPlanModeTool.call', () => {
  test('switches the permission mode to plan and records prePlanMode', async () => {
    const ctx = makeContext()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (EnterPlanModeTool.call as any)({}, ctx)
    expect(result.data.message).toContain('Entered plan mode')
    expect(ctx.getState().toolPermissionContext.mode).toBe('plan')
    expect(ctx.getState().toolPermissionContext.prePlanMode).toBe('default')
  })

  test('throws when invoked inside an agent context', async () => {
    const ctx = makeContext('agent-1')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((EnterPlanModeTool.call as any)({}, ctx)).rejects.toThrow(
      'cannot be used in agent contexts',
    )
  })

  test('is enabled by default', () => {
    expect(EnterPlanModeTool.isEnabled()).toBe(true)
  })
})
