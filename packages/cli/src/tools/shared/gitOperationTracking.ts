// Git/PR operation tracking feeds usage counters and session→PR linking, both
// of which belong to the analytics/session-storage layer that knightcode does
// not ship. The shell tools call this after every command, so it stays as an
// inert hook with the same signature — wire real behavior only if a
// non-telemetry consumer ever needs it.

/**
 * Inspect a completed shell command for git/gh/glab operations. Currently a
 * no-op; the call sites remain so the detection can be restored in one place.
 */
export function trackGitOperations(
  _command: string,
  _exitCode: number,
  _stdout: string,
): void {}
