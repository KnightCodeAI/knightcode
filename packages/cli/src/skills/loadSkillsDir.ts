// TODO: skill discovery/activation lands with the skills phase. The Read tool
// triggers conditional skills when it reads files under skill directories;
// with no skills loaded these are inert.

export async function discoverSkillDirsForPaths(
  _filePaths: string[],
  _cwd: string,
): Promise<string[]> {
  return []
}

export async function addSkillDirectories(_dirs: string[]): Promise<void> {}

export function activateConditionalSkillsForPaths(
  _filePaths: string[],
  _cwd: string,
): string[] {
  return []
}
