import { describe, expect, test } from 'bun:test'
import type { CompactionResult } from './compact.js'
import { buildPostCompactMessages } from './compact.js'
import {
  calculateTokenWarningState,
  getEffectiveContextWindowSize,
  isAutoCompactEnabled,
} from './autoCompact.js'
import type {
  AttachmentMessage,
  SystemCompactBoundaryMessage,
  UserMessage,
} from '../../types/message.js'

const MODEL = 'claude-test-model'

describe('calculateTokenWarningState', () => {
  test('a near-window count is more severe than a low count', () => {
    const effectiveWindow = getEffectiveContextWindowSize(MODEL)

    const low = calculateTokenWarningState(1_000, MODEL)
    const nearWindow = calculateTokenWarningState(effectiveWindow - 1, MODEL)

    // Low usage: nowhere near any threshold.
    expect(low.isAboveWarningThreshold).toBe(false)
    expect(low.isAboveErrorThreshold).toBe(false)
    expect(low.isAboveAutoCompactThreshold).toBe(false)
    expect(low.isAtBlockingLimit).toBe(false)

    // Near the window: every escalating flag has tripped.
    expect(nearWindow.isAboveWarningThreshold).toBe(true)
    expect(nearWindow.isAboveErrorThreshold).toBe(true)
    expect(nearWindow.isAboveAutoCompactThreshold).toBe(true)
    expect(nearWindow.isAtBlockingLimit).toBe(true)

    // And less context remains.
    expect(nearWindow.percentLeft).toBeLessThan(low.percentLeft)
    expect(nearWindow.percentLeft).toBe(0)
    expect(low.percentLeft).toBeGreaterThan(0)
  })

  test('percentLeft is clamped to the 0..100 range', () => {
    const overWindow = calculateTokenWarningState(10_000_000, MODEL)
    expect(overWindow.percentLeft).toBe(0)
    expect(overWindow.isAtBlockingLimit).toBe(true)
  })
})

describe('isAutoCompactEnabled', () => {
  test('defaults to enabled', () => {
    expect(isAutoCompactEnabled()).toBe(true)
  })
})

describe('buildPostCompactMessages', () => {
  test('rebuilt array starts with the boundary then summary, preserving the kept tail', () => {
    const boundaryMarker = {
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Conversation compacted',
      isMeta: false,
      timestamp: new Date().toISOString(),
      uuid: '00000000-0000-0000-0000-000000000001',
      level: 'info',
      compactMetadata: { trigger: 'auto', preTokens: 1234 },
    } as SystemCompactBoundaryMessage

    const summary = {
      type: 'user',
      message: { role: 'user', content: 'SUMMARY' },
      uuid: '00000000-0000-0000-0000-000000000002',
      timestamp: new Date().toISOString(),
      isCompactSummary: true,
    } as UserMessage

    const keptUser = {
      type: 'user',
      message: { role: 'user', content: 'kept message' },
      uuid: '00000000-0000-0000-0000-000000000003',
      timestamp: new Date().toISOString(),
    } as UserMessage

    const attachment: AttachmentMessage = {
      type: 'attachment',
      attachment: { type: 'plan_mode' },
      uuid: '00000000-0000-0000-0000-000000000004',
      timestamp: new Date().toISOString(),
    }

    const result: CompactionResult = {
      boundaryMarker,
      summaryMessages: [summary],
      messagesToKeep: [keptUser],
      attachments: [attachment],
      hookResults: [],
    }

    const rebuilt = buildPostCompactMessages(result)

    // Order: boundary, summary(s), kept, attachments, hooks.
    expect(rebuilt[0]).toBe(boundaryMarker)
    expect(rebuilt[1]).toBe(summary)
    expect(rebuilt[2]).toBe(keptUser)
    expect(rebuilt[3]).toBe(attachment)
    expect(rebuilt).toHaveLength(4)

    // The kept post-summary message survives unchanged.
    expect(rebuilt.includes(keptUser)).toBe(true)
  })

  test('omitting messagesToKeep yields boundary + summary + attachments only', () => {
    const boundaryMarker = {
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Conversation compacted',
      isMeta: false,
      timestamp: new Date().toISOString(),
      uuid: '00000000-0000-0000-0000-000000000011',
      level: 'info',
      compactMetadata: { trigger: 'manual', preTokens: 0 },
    } as SystemCompactBoundaryMessage

    const summary = {
      type: 'user',
      message: { role: 'user', content: 'SUMMARY ONLY' },
      uuid: '00000000-0000-0000-0000-000000000012',
      timestamp: new Date().toISOString(),
      isCompactSummary: true,
    } as UserMessage

    const result: CompactionResult = {
      boundaryMarker,
      summaryMessages: [summary],
      attachments: [],
      hookResults: [],
    }

    const rebuilt = buildPostCompactMessages(result)
    expect(rebuilt[0]).toBe(boundaryMarker)
    expect(rebuilt[1]).toBe(summary)
    expect(rebuilt).toHaveLength(2)
  })
})
