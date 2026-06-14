// TODO: remote skill search (the EXPERIMENTAL_SKILL_SEARCH subsystem) is not in
// the reference source and is off by default. These are the inert state helpers
// the Skill tool references behind the feature flag; with search disabled no
// remote skill is ever discovered.

export function isSkillSearchEnabled(): boolean {
  return false
}

// Strip the canonical remote-skill prefix from a command name. With search off
// nothing is a remote skill, so report "not a remote skill" (null).
export function stripCanonicalPrefix(_commandName: string): string | null {
  return null
}

export type DiscoveredRemoteSkill = {
  slug: string
  url: string
  [key: string]: unknown
}

export function getDiscoveredRemoteSkill(
  _slug: string,
): DiscoveredRemoteSkill | undefined {
  return undefined
}
