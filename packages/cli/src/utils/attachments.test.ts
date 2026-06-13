import { describe, expect, test } from 'bun:test'
import {
  createAttachmentMessage,
  filterDuplicateMemoryAttachments,
  type Attachment,
} from './attachments.js'
import { FileStateCache } from './fileStateCache.js'

describe('createAttachmentMessage', () => {
  test('wraps an attachment in a well-formed attachment message', () => {
    const attachment: Attachment = { type: 'date_change', newDate: '2026-06-13' }
    const message = createAttachmentMessage(attachment)

    expect(message.type).toBe('attachment')
    expect(message.attachment).toEqual(attachment)
    expect(typeof message.uuid).toBe('string')
    expect(typeof message.timestamp).toBe('string')
  })
})

describe('filterDuplicateMemoryAttachments', () => {
  test('drops memories already present in the read-file cache', () => {
    const cache = new FileStateCache(100, 1_000_000)
    cache.set('/repo/seen.md', {
      content: 'already surfaced',
      timestamp: 1,
      offset: undefined,
      limit: undefined,
    })

    const attachment: Attachment = {
      type: 'relevant_memories',
      memories: [
        { path: '/repo/seen.md', content: 'already surfaced', mtimeMs: 1 },
        { path: '/repo/fresh.md', content: 'new memory', mtimeMs: 2 },
      ],
    }

    const result = filterDuplicateMemoryAttachments([attachment], cache)

    expect(result).toHaveLength(1)
    const kept = result[0]!
    expect(kept.type).toBe('relevant_memories')
    if (kept.type === 'relevant_memories') {
      expect(kept.memories.map(m => m.path)).toEqual(['/repo/fresh.md'])
    }
    // The freshly surfaced memory is now recorded in the cache.
    expect(cache.has('/repo/fresh.md')).toBe(true)
  })

  test('drops the attachment entirely when every memory is a duplicate', () => {
    const cache = new FileStateCache(100, 1_000_000)
    cache.set('/repo/seen.md', {
      content: 'x',
      timestamp: 1,
      offset: undefined,
      limit: undefined,
    })

    const attachment: Attachment = {
      type: 'relevant_memories',
      memories: [{ path: '/repo/seen.md', content: 'x', mtimeMs: 1 }],
    }

    expect(filterDuplicateMemoryAttachments([attachment], cache)).toHaveLength(0)
  })
})
