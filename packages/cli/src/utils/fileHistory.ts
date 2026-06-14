// TODO: only the snapshot types live here so the log types compile; the
// backup/restore implementation lands with file-change tracking.

import type { UUID } from 'crypto'

/** Backup file name; null means the file did not exist in this version. */
type BackupFileName = string | null

export type FileHistoryBackup = {
  backupFileName: BackupFileName
  version: number
  backupTime: Date
}

/** Snapshot of tracked file backups associated with one message. */
export type FileHistorySnapshot = {
  messageId: UUID
  trackedFileBackups: Record<string, FileHistoryBackup>
  timestamp: Date
}

export type FileHistoryState = {
  snapshots: FileHistorySnapshot[]
  trackedFiles: Set<string>
  // Monotonically-increasing counter incremented on every snapshot, even when
  // old snapshots are evicted. Used as an activity signal (snapshots.length
  // plateaus once the cap is reached).
  snapshotSequence: number
}

// TODO: file checkpointing (backup-before-edit, restore) lands with the
// file-change tracking layer. Until then it is reported disabled and the edit
// tracker is inert, so writes/edits proceed without snapshots.
export function fileHistoryEnabled(): boolean {
  return false
}

export type DiffStats =
  | {
      filesChanged?: string[]
      insertions: number
      deletions: number
    }
  | undefined

export function fileHistoryCanRestore(
  state: FileHistoryState,
  messageId: UUID,
): boolean {
  if (!fileHistoryEnabled()) {
    return false
  }

  return state.snapshots.some(snapshot => snapshot.messageId === messageId)
}

// TODO: diff stats for a restore point are computed by the file-change tracking
// layer. Until it lands there is nothing snapshotted to diff against.
export async function fileHistoryGetDiffStats(
  _state: FileHistoryState,
  _messageId: UUID,
): Promise<DiffStats> {
  return undefined
}

export async function fileHistoryTrackEdit(
  _updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void,
  _filePath: string,
  _messageId: UUID,
): Promise<void> {}

// TODO: snapshotting the working tree at a turn boundary (so edits can be rolled
// back to that point) is part of the file-change tracking layer. Until it lands
// there is nothing to snapshot, so this is inert.
export async function fileHistoryMakeSnapshot(
  _updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void,
  _messageId: UUID,
): Promise<void> {}

// TODO: file-history resume/rewind land with the snapshot store; inert.
export async function copyFileHistoryForResume(_log: unknown): Promise<void> {}
export async function fileHistoryHasAnyChanges(..._args: unknown[]): Promise<boolean> { return false }
export async function fileHistoryRewind(..._args: any[]): Promise<any> { return null }

export function fileHistoryRestoreStateFromLog(..._args: any[]): any { return null }
