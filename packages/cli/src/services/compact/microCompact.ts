// TODO: microcompaction (cache-edit pinning) lands with the compaction layer.

import type {
  CacheEditsBlock,
  PinnedCacheEdits,
} from './cachedMicrocompact.js'

export function consumePendingCacheEdits(): CacheEditsBlock | null {
  return null
}

export function getPinnedCacheEdits(): PinnedCacheEdits[] {
  return []
}

export function markToolsSentToAPIState(): void {}

export function pinCacheEdits(
  _userMessageIndex: number,
  _edits: CacheEditsBlock | null | undefined,
): void {}
