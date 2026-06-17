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
// Bound the map so a long-lived process churning through many sessions can't
// grow it without limit. Map keeps insertion order, so the first key is the
// oldest — evict it when we exceed the cap.
const MAX_CURSORS = 1000;

export function getExtractCursor(sessionId: string): number | undefined {
  return cursors.get(sessionId);
}

export function setExtractCursor(sessionId: string, index: number): void {
  // Re-insert to mark as most-recent (delete first so order reflects recency).
  cursors.delete(sessionId);
  cursors.set(sessionId, index);
  if (cursors.size > MAX_CURSORS) {
    const oldest = cursors.keys().next().value;
    if (oldest !== undefined) cursors.delete(oldest);
  }
}

/** Test seam: clear all cursors. */
export function resetExtractCursors(): void {
  cursors.clear();
}
