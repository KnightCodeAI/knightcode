// TODO: swarm team-file management (the on-disk roster of teammates in a swarm,
// including removing a teammate after an approved shutdown) is not implemented
// yet. The attachment pipeline calls this when processing shutdown approvals;
// until the swarm subsystem lands there is no team file to update.
export function removeTeammateFromTeamFile(
  _teamName: string,
  _identifier: { agentId?: string; name?: string },
): boolean {
  return false
}
