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

// Rough token estimate of a skill's frontmatter (name/description/whenToUse),
// used by the /context analyzer to size loaded skills.
import type { Command } from '../commands.js'
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'

export function estimateSkillFrontmatterTokens(skill: Command): number {
  const frontmatterText = [skill.name, skill.description, skill.whenToUse]
    .filter(Boolean)
    .join(' ')
  return roughTokenCountEstimation(frontmatterText)
}
