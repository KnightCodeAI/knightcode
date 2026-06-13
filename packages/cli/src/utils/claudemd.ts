// TODO: memory-file (CLAUDE.md) loading and its caches are not implemented yet.
// Compaction resets the cache so the InstructionsLoaded hook re-fires on the
// next turn; until the loader lands there is nothing cached to reset. The
// discovery functions below report no memory files so the attachment pipeline
// runs without injected instructions.

import type { MemoryType } from './memory/types.js'

export type MemoryFileInfo = {
  path: string
  type: MemoryType
  content: string
  parent?: string
  globs?: string[]
  contentDiffersFromDisk?: boolean
  rawContent?: string
}

export function filterInjectedMemoryFiles(
  files: MemoryFileInfo[],
): MemoryFileInfo[] {
  return files
}

export async function getMemoryFiles(
  _forceIncludeExternal: boolean = false,
): Promise<MemoryFileInfo[]> {
  return []
}

export async function getManagedAndUserConditionalRules(
  _targetPath: string,
  _processedPaths: Set<string>,
): Promise<MemoryFileInfo[]> {
  return []
}

export async function getMemoryFilesForNestedDirectory(
  _dir: string,
  _targetPath: string,
  _processedPaths: Set<string>,
): Promise<MemoryFileInfo[]> {
  return []
}

export async function getConditionalRulesForCwdLevelDirectory(
  _dir: string,
  _targetPath: string,
  _processedPaths: Set<string>,
): Promise<MemoryFileInfo[]> {
  return []
}

type InstructionsLoadReason =
  | 'session_start'
  | 'nested_traversal'
  | 'path_glob_match'
  | 'include'
  | 'compact'

export function resetGetMemoryFilesCache(
  _reason: InstructionsLoadReason = 'session_start',
): void {}
