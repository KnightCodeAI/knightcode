import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { getMemoryDir } from "./paths";

const LOCK_FILE = ".consolidate-lock";
// Treat a lock as stale past this even if its PID is live (PID-reuse guard).
const HOLDER_STALE_MS = 60 * 60 * 1000;

function lockPath(cwd: string): string {
  return join(getMemoryDir(cwd), LOCK_FILE);
}

/** True if a process with this pid is currently running. */
function isProcessRunning(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it → still running.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * mtime of the lock file = the last consolidation time. 0 if absent.
 * (The lock file's mtime is lastConsolidatedAt; its body is the holder PID.)
 */
export function readLastConsolidatedAt(cwd: string): number {
  try {
    return statSync(lockPath(cwd)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Acquire the lock: write our PID, stamping mtime = now. Returns the pre-acquire
 * mtime (for rollback) on success, or null if another live, non-stale holder
 * owns it. A dead/stale/unparseable holder is reclaimed.
 */
export function tryAcquireConsolidationLock(cwd: string): number | null {
  const path = lockPath(cwd);
  let mtimeMs: number | undefined;
  let holderPid: number | undefined;
  if (existsSync(path)) {
    try {
      mtimeMs = statSync(path).mtimeMs;
      const parsed = parseInt(readFileSync(path, "utf8").trim(), 10);
      holderPid = Number.isFinite(parsed) ? parsed : undefined;
    } catch {
      // treat as no usable lock
    }
  }

  if (
    mtimeMs !== undefined &&
    Date.now() - mtimeMs < HOLDER_STALE_MS &&
    holderPid !== undefined &&
    holderPid !== process.pid &&
    isProcessRunning(holderPid)
  ) {
    return null; // a live holder owns it
  }

  try {
    mkdirSync(getMemoryDir(cwd), { recursive: true });
    writeFileSync(path, String(process.pid));
    // Race guard: if two reclaimers wrote, last PID wins; the loser bails.
    if (parseInt(readFileSync(path, "utf8").trim(), 10) !== process.pid) {
      return null;
    }
  } catch {
    return null;
  }
  return mtimeMs ?? 0;
}

/**
 * Rewind the lock to its pre-acquire state after a failed/aborted run, so the
 * time-gate opens again. priorMtime 0 → remove the file entirely.
 */
export function rollbackConsolidationLock(cwd: string, priorMtime: number): void {
  const path = lockPath(cwd);
  try {
    if (priorMtime === 0) {
      if (existsSync(path)) unlinkSync(path);
      return;
    }
    writeFileSync(path, "");
    const t = priorMtime / 1000; // utimes wants seconds
    utimesSync(path, t, t);
  } catch {
    // best-effort; next trigger just waits the full interval
  }
}
