// TODO: PID-based install locking — coordinates the native installer/updater
// across processes. The native installer isn't ported, so locking is inert and
// reports no held locks.

export type LockInfo = {
  pid: number
  [key: string]: any
}

export function isPidBasedLockingEnabled(): boolean {
  return false
}

export function cleanupStaleLocks(_locksDir: string): number {
  return 0
}

export function getAllLockInfo(_locksDir: string): LockInfo[] {
  return []
}
