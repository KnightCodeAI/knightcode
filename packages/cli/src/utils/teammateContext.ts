// TODO: in-process teammate context (the async-local store that marks the
// current execution as running inside a swarm teammate) is not implemented yet.
// The attachment pipeline checks this to decide whether to surface the leader's
// inbox; until the swarm subsystem lands the harness is never an in-process
// teammate.
export function isInProcessTeammate(): boolean {
  return false
}
