// TODO: relevance-ranked memory retrieval (scanning the memory directory and
// selecting the files most relevant to the current query) is not implemented
// yet. The attachment pipeline surfaces matching memories into the turn; until
// the memory-retrieval subsystem lands nothing is found.

export type RelevantMemory = {
  path: string
  mtimeMs: number
}

export async function findRelevantMemories(
  _query: string,
  _memoryDir: string,
  _signal: AbortSignal,
  _recentTools: readonly string[] = [],
  _alreadySurfaced: ReadonlySet<string> = new Set(),
): Promise<RelevantMemory[]> {
  return []
}
