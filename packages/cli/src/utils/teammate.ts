// TODO: the teammate/swarm subsystem (in-process AsyncLocalStorage context and
// tmux/iTerm2 dynamic team context) isn't ported. These solo-mode defaults
// report "not a teammate", so the stop-hook spine skips the TeammateIdle /
// TaskCompleted branches entirely until that subsystem lands.

export function getAgentName(): string | undefined {
  return undefined
}

export function getTeamName(_teamContext?: {
  teamName: string
}): string | undefined {
  return undefined
}

export function isTeammate(): boolean {
  return false
}

export function isPlanModeRequired(): boolean {
  return false
}

export function getAgentId(): string | undefined {
  return undefined
}

export function isTeamLead(
  _teamContext: { leadAgentId: string } | undefined,
): boolean {
  return false
}
