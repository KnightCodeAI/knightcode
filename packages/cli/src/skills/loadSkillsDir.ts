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
import { join } from 'path'
import type { Command } from '../commands.js'
import { roughTokenCountEstimation } from '../services/tokenEstimation.js'
import { getKnightcodeConfigHomeDir } from '../utils/envUtils.js'
import { getManagedFilePath } from '../utils/settings/managedPath.js'
import type { SettingSource } from '../utils/settings/constants.js'

// The on-disk location of a settings source's skills/commands directory, used
// by the /skills menu to show where each skill lives.
export function getSkillsPath(
  source: SettingSource | 'plugin',
  dir: 'skills' | 'commands',
): string {
  switch (source) {
    case 'policySettings':
      return join(getManagedFilePath(), '.knightcode', dir)
    case 'userSettings':
      return join(getKnightcodeConfigHomeDir(), dir)
    case 'projectSettings':
      return `.knightcode/${dir}`
    case 'plugin':
      return 'plugin'
    default:
      return ''
  }
}

export function estimateSkillFrontmatterTokens(skill: Command): number {
  const frontmatterText = [skill.name, skill.description, skill.whenToUse]
    .filter(Boolean)
    .join(' ')
  return roughTokenCountEstimation(frontmatterText)
}

export function clearDynamicSkills(): void {}

// Discovered skill-directory commands and dynamically-activated skills. Full
// disk discovery lands with the skills phase; until then there are none, and
// clearing the (empty) caches is a no-op.
export async function getSkillDirCommands(_cwd: string): Promise<Command[]> {
  return []
}

export function getDynamicSkills(): Command[] {
  return []
}

export function clearSkillCaches(): void {}
