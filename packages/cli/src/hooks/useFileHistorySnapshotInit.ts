// TODO: file-history snapshot init — gated off, not ported.

import type { FileHistoryState, FileHistorySnapshot } from '../utils/fileHistory.js'

export function useFileHistorySnapshotInit(
  _initialFileHistorySnapshots: FileHistorySnapshot[] | undefined,
  _fileHistoryState: FileHistoryState,
  _onUpdateState: (newState: FileHistoryState) => void,
): void {}
