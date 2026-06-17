/**
 * Per-session extraction cursor: the message-array length up to which memory
 * extraction has last *actually run* for a session.
 *
 * Why: extraction skips trivial turns and turns the main agent already saved
 * memory on. Without a cursor, the next real extraction is told to consider
 * only "the last turn", so those gate-skipped turns are never reconsidered. The
 * cursor lets extraction frame everything since the last successful run as new,
 * so a durable fact mentioned during a skipped turn still gets a chance to land.
 *
 * In-memory only (lives for the process). Keyed by session id.
 */
const cursors = new Map<string, number>();

export function getExtractCursor(sessionId: string): number | undefined {
  return cursors.get(sessionId);
}

export function setExtractCursor(sessionId: string, index: number): void {
  cursors.set(sessionId, index);
}

/** Test seam: clear all cursors. */
export function resetExtractCursors(): void {
  cursors.clear();
}
