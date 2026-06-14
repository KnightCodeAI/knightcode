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

// Above this character count a CLAUDE.md is large enough that the statusline
// warns it is eating into the context window.
export const MAX_MEMORY_CHARACTER_COUNT = 40000

export function getLargeMemoryFiles(
  files: MemoryFileInfo[],
): MemoryFileInfo[] {
  return files.filter(f => f.content.length > MAX_MEMORY_CHARACTER_COUNT)
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

// An external CLAUDE.md include reached from outside the original cwd.
export type ExternalClaudeMdInclude = {
  path: string
  parent: string
}

export function getExternalClaudeMdIncludes(files: MemoryFileInfo[]): ExternalClaudeMdInclude[] {
  const externals: ExternalClaudeMdInclude[] = []
  for (const file of files) {
    if (file.type !== 'User' && file.parent) {
      externals.push({ path: file.path, parent: file.parent })
    }
  }
  return externals
}

export function hasExternalClaudeMdIncludes(files: MemoryFileInfo[]): boolean {
  return getExternalClaudeMdIncludes(files).length > 0
}

export function clearMemoryFileCaches(): void {}
