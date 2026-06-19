import { statSync } from "fs";

/**
 * Session-scoped read-state ledger: per session, the resolved absolute path of
 * every file the model has read this session → that file's mtimeMs at read
 * time. Mirrors session-snapshot.ts (the undo ledger) — a module-level map keyed
 * by sessionId, so it survives across turns within a process and is shared
 * between the Read tool (records reads) and the edit tools (check before write,
 * refresh after). The engine seeds it from the transcript at turn start
 * (seedFileLedgerFromTranscript) so it survives a resume across restart.
 */
const sessionReadState = new Map<string, Map<string, number>>();

function ledgerFor(sessionId: string): Map<string, number> {
  let m = sessionReadState.get(sessionId);
  if (!m) {
    m = new Map();
    sessionReadState.set(sessionId, m);
  }
  return m;
}

/** Record that `resolvedPath` was just read; stores its current mtime. No-op if
 *  the file can't be stat'd (vanished between read and record). */
export function recordRead(sessionId: string, resolvedPath: string): void {
  try {
    ledgerFor(sessionId).set(resolvedPath, statSync(resolvedPath).mtimeMs);
  } catch {
    // nothing to record
  }
}

/** Record a successful write — refresh the stored mtime so back-to-back edits
 *  on the same file don't trip the staleness check. */
export function recordWrite(sessionId: string, resolvedPath: string): void {
  recordRead(sessionId, resolvedPath);
}

/**
 * Throw if `resolvedPath` may not be safely written:
 * - never read this session → "read it first" (unless `allowCreate` and the file
 *   does not yet exist — a genuine create);
 * - newer on disk than the recorded read → "modified since read".
 * Call before an edit/write executes; call recordWrite after it succeeds.
 */
export function assertWritable(
  sessionId: string,
  resolvedPath: string,
  opts: { allowCreate?: boolean } = {},
): void {
  const recorded = ledgerFor(sessionId).get(resolvedPath);

  let exists = true;
  let currentMtime = 0;
  try {
    currentMtime = statSync(resolvedPath).mtimeMs;
  } catch {
    exists = false;
  }

  if (recorded === undefined) {
    if (opts.allowCreate && !exists) return; // creating a brand-new file
    throw new Error(
      `File has not been read yet. Read ${resolvedPath} first before writing to it.`,
    );
  }
  // Strict `>`: an unchanged file (equal mtime) is fine; only a later mtime is
  // a real external/foreign modification.
  if (exists && currentMtime > recorded) {
    throw new Error(
      `File has been modified since you last read it (by you, the user, or a tool). Read ${resolvedPath} again before writing to it.`,
    );
  }
}

/** Drop a session's read-state (session end). */
export function clearFileLedger(sessionId: string): void {
  sessionReadState.delete(sessionId);
}

/** Current recorded mtime for a path, or undefined. (Seed/test helper.) */
export function getLedgerEntry(
  sessionId: string,
  resolvedPath: string,
): number | undefined {
  return sessionReadState.get(sessionId)?.get(resolvedPath);
}
