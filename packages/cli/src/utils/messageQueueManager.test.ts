import { afterEach, describe, expect, test } from 'bun:test'
import {
  enqueue,
  getCommandsByMaxPriority,
  getCommandQueueSnapshot,
  isSlashCommand,
  remove,
  resetCommandQueue,
} from './messageQueueManager.js'
import type { QueuedCommand } from '../types/textInputTypes.js'

function cmd(value: string, priority: QueuedCommand['priority']): QueuedCommand {
  return { value, mode: 'prompt', priority }
}

afterEach(() => {
  resetCommandQueue()
})

describe('messageQueueManager', () => {
  test('getCommandsByMaxPriority returns only commands at or above the tier', () => {
    enqueue(cmd('urgent', 'now'))
    enqueue(cmd('soon', 'next'))
    enqueue(cmd('eventually', 'later'))

    // 'now' is the highest priority (lowest order value); only it qualifies.
    const nowOnly = getCommandsByMaxPriority('now')
    expect(nowOnly.map(c => c.value)).toEqual(['urgent'])

    // 'next' includes 'now' + 'next' but not 'later'.
    const upToNext = getCommandsByMaxPriority('next')
    expect(upToNext.map(c => c.value)).toEqual(['urgent', 'soon'])

    // 'later' includes everything.
    const all = getCommandsByMaxPriority('later')
    expect(all.map(c => c.value)).toEqual(['urgent', 'soon', 'eventually'])
  })

  test('remove drops the consumed commands and leaves the rest', () => {
    const keep = cmd('keep', 'next')
    const drop = cmd('drop', 'next')
    enqueue(keep)
    enqueue(drop)

    const enqueued = getCommandQueueSnapshot()
    expect(enqueued).toHaveLength(2)

    // remove matches by reference identity of the enqueued command objects.
    remove([enqueued[1]!])

    const remaining = getCommandQueueSnapshot()
    expect(remaining.map(c => c.value)).toEqual(['keep'])
  })

  test('isSlashCommand distinguishes slash commands from plain text', () => {
    expect(isSlashCommand(cmd('/help', 'next'))).toBe(true)
    expect(isSlashCommand(cmd('just a message', 'next'))).toBe(false)
    // skipSlashCommands forces plain-text treatment even for a leading slash.
    expect(
      isSlashCommand({ value: '/help', mode: 'prompt', skipSlashCommands: true }),
    ).toBe(false)
  })
})
