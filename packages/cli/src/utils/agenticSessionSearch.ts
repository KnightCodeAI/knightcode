import type { LogOption } from '../types/logs.js'

// TODO: agentic session search — natural-language search over past transcripts.
// The transcript store and search index aren't ported, so this returns no hits.

export async function agenticSessionSearch(
  _query: string,
  _logs: LogOption[],
  _signal?: AbortSignal,
): Promise<LogOption[]> {
  return []
}
