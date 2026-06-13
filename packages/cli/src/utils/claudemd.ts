// TODO: memory-file (CLAUDE.md) loading and its caches are not implemented yet.
// Compaction resets the cache so the InstructionsLoaded hook re-fires on the
// next turn; until the loader lands there is nothing cached to reset.

type InstructionsLoadReason =
  | 'session_start'
  | 'nested_traversal'
  | 'path_glob_match'
  | 'include'
  | 'compact'

export function resetGetMemoryFilesCache(
  _reason: InstructionsLoadReason = 'session_start',
): void {}
