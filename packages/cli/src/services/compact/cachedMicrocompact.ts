// TODO: cache-editing microcompaction is not implemented yet; the block shapes
// and state surface match what the request builder threads through, but the
// path is gated off (isCachedMicrocompactEnabled returns false) until it lands.

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export type CachedMCState = {
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
  pinnedEdits: PinnedCacheEdits[]
}

export type CachedMCConfig = {
  supportedModels: string[]
  triggerThreshold: number
  keepRecent: number
}

export function isCachedMicrocompactEnabled(): boolean {
  return false
}

export function isModelSupportedForCacheEditing(_model: string): boolean {
  return false
}

export function getCachedMCConfig(): CachedMCConfig {
  return { supportedModels: [], triggerThreshold: 0, keepRecent: 0 }
}

export function createCachedMCState(): CachedMCState {
  return {
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
    pinnedEdits: [],
  }
}

export function markToolsSentToAPI(_state: CachedMCState): void {}

export function resetCachedMCState(_state: CachedMCState): void {}

export function registerToolResult(
  _state: CachedMCState,
  _toolUseId: string,
): void {}

export function registerToolMessage(
  _state: CachedMCState,
  _toolUseIds: string[],
): void {}

export function getToolResultsToDelete(_state: CachedMCState): string[] {
  return []
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  _toolsToDelete: string[],
): CacheEditsBlock | null {
  return null
}
