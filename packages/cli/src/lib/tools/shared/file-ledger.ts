import { statSync } from "fs";
import { resolveInsideRoot } from "./path-resolution";

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
  let statErrorCode: string | undefined;
  try {
    currentMtime = statSync(resolvedPath).mtimeMs;
  } catch (err) {
    exists = false;
    statErrorCode = (err as NodeJS.ErrnoException)?.code;
  }

  if (recorded === undefined) {
    // Only a genuinely-absent file (ENOENT) is a safe brand-new create. A stat
    // that failed for any OTHER reason (EACCES, EPERM, a broken symlink, …) may
    // be masking an existing file we never read — don't let allowCreate wave it
    // through and silently clobber it.
    if (opts.allowCreate && statErrorCode === "ENOENT") return;
    throw new Error(
      `File has not been read yet. Read ${resolvedPath} first before writing to it.`,
    );
  }

  // We recorded a read for this path, but it's no longer stat-able. A deletion
  // since the read is a change we never saw, so it can't silently fall through
  // the staleness check below.
  if (!exists) {
    // A create-capable write (Write) legitimately recreates a deleted file —
    // there is no content left to clobber and nothing to re-read.
    if (statErrorCode === "ENOENT" && opts.allowCreate) return;
    throw new Error(
      statErrorCode === "ENOENT"
        ? `File has been deleted since you last read it. Read ${resolvedPath} again before writing to it.`
        : `Could not verify ${resolvedPath} before writing (stat failed: ${statErrorCode}). Read it again before writing to it.`,
    );
  }

  // Strict `>`: an unchanged file (equal mtime) is fine; only a later mtime is
  // a real external/foreign modification.
  if (currentMtime > recorded) {
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

/**
 * Seed the ledger from a transcript: every successful `Read` tool call becomes a
 * recorded read at the file's CURRENT mtime. Lets the guard survive a resume so
 * the model isn't forced to re-read files it already read this session. Records
 * current mtime (the transcript has no stored mtime); an external edit made
 * while the process was down is therefore not detected — acceptable, the same
 * limitation claude-code accepts. Best-effort: never throws.
 */
export function seedFileLedgerFromTranscript(
  sessionId: string,
  messages: { parts?: unknown[] }[],
  cwd: string,
): void {
  for (const message of messages ?? []) {
    for (const part of message?.parts ?? []) {
      const p = part as {
        type?: string;
        state?: string;
        input?: { file_path?: unknown };
      };
      if (p?.type !== "tool-Read" || p?.state !== "output-available") continue;
      const filePath = p.input?.file_path;
      if (typeof filePath !== "string" || !filePath) continue;
      try {
        const { resolved } = resolveInsideRoot(cwd, filePath);
        recordRead(sessionId, resolved); // no-op if the file no longer exists
      } catch {
        // path outside root / unresolvable — skip
      }
    }
  }
}
