// TODO: remote skill-search telemetry (the EXPERIMENTAL_SKILL_SEARCH subsystem)
// is not in the reference source and is off by default. Inert: records nothing.

export function recordRemoteSkillEvent(..._args: unknown[]): void {}

export function logRemoteSkillLoaded(_fields: {
  slug: string
  cacheHit: boolean
  latencyMs: number
  urlScheme?: string
  error?: string
  [key: string]: unknown
}): void {}
