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
