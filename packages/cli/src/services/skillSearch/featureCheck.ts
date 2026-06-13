// TODO: experimental skill-search feature gating is not implemented yet. The
// attachment pipeline consults this behind a build-time feature flag; until the
// skill-search subsystem lands it reports disabled.
export function isSkillSearchEnabled(): boolean {
  return false
}
