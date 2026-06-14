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
  // How many times the user pressed Escape during a permission prompt (used to
  // tune the attribution surface).
  escapeCount: number
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
    escapeCount: 0,
  }
}

// Empty attribution state for the initial app state (no surface attributed yet).
export function createEmptyAttributionState(): AttributionState {
  return createAttributionState('')
}
