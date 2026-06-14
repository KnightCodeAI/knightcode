// TODO: the bundled skill set (the skills that ship with the CLI) is registered
// at startup by the skills phase. Until then nothing is registered, so the
// registry sees no bundled skills.
import type { Command } from '../commands.js'

const bundledSkills: Command[] = []

export function registerBundledSkill(_skill: Command): void {}

export function getBundledSkills(): Command[] {
  return [...bundledSkills]
}
