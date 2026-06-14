// TODO: in-process teammate context (the async-local store that marks the
// current execution as running inside a swarm teammate) is not implemented yet.
// The attachment pipeline checks this to decide whether to surface the leader's
// inbox; until the swarm subsystem lands the harness is never an in-process
// teammate.
export function isInProcessTeammate(): boolean {
  return false
}

export type TeammateContext = {
  /** Full agent ID, e.g., "researcher@my-team" */
  agentId: string
  /** Display name, e.g., "researcher" */
  agentName: string
  /** Team name this teammate belongs to */
  teamName: string
  /** UI color assigned to this teammate */
  color?: string
  /** Whether teammate must enter plan mode before implementing */
  planModeRequired: boolean
  /** Leader's session ID (for transcript correlation) */
  parentSessionId: string
  /** Discriminator - always true for in-process teammates */
  isInProcess: true
  /** Abort controller for lifecycle management (linked to parent) */
  abortController: AbortController
}

// TODO: returns the current in-process teammate's context once the swarm
// subsystem lands. The local-only build never runs inside a teammate, so there
// is no context to return.
export function getTeammateContext(): TeammateContext | undefined {
  return undefined
}
