// TODO: the REPL tool (and the deferral/availability gating that reads the
// rest of this module upstream) lands later. Only its name constant —
// referenced by the permission layer — lives here for now.

export const REPL_TOOL_NAME = 'REPL'

// TODO: REPL mode (an ant-gated alternative tool surface) lands with the REPL
// tool. It is off in this build, so callers fall back to the standard tools.
export function isReplModeEnabled(): boolean {
  return false
}
