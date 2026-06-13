// TODO: team memory sync is out of scope (no team/account backend). The file
// tools call this to block writing secrets into synced team-memory files; with
// the feature off there is nothing to guard, so it never blocks.

export function checkTeamMemSecrets(
  _filePath: string,
  _content: string,
): string | null {
  return null
}
