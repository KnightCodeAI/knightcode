// TODO: remote skill loading (the EXPERIMENTAL_SKILL_SEARCH subsystem) is not in
// the reference source and is off by default. Inert: never loads a skill (this
// path is unreachable while the feature flag is off).

export type RemoteSkillLoadResult = {
  cacheHit: boolean
  latencyMs: number
  skillPath: string
  content: string
  fileCount: number
  totalBytes: number
  fetchMethod: string
}

export async function loadRemoteSkill(
  _slug: string,
  _url: string,
): Promise<RemoteSkillLoadResult> {
  throw new Error('Remote skill loading is not supported')
}
