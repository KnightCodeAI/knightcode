// TODO: commit-attribution tracking (per-file edit provenance, session
// baselines, steer counting) lands later. The tool context threads
// AttributionState through updateAttributionState; only the type surface lives
// here until the real tracker ports.

export type FileAttributionState = {
  [key: string]: unknown
}

export type AttributionState = {
  fileStates: Map<string, FileAttributionState>
  sessionBaselines: Map<string, { contentHash: string; mtime: number }>
  surface: string
  startingHeadSha: string | null
  promptCount: number
  promptCountAtLastCommit: number
  permissionPromptCount: number
  permissionPromptCountAtLastCommit: number
}

export function createAttributionState(surface: string): AttributionState {
  return {
    fileStates: new Map(),
    sessionBaselines: new Map(),
    surface,
    startingHeadSha: null,
    promptCount: 0,
    promptCountAtLastCommit: 0,
    permissionPromptCount: 0,
    permissionPromptCountAtLastCommit: 0,
  }
}
