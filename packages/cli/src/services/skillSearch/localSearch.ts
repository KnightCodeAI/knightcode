// TODO: the local skill search index lands with the skills phase. It sits behind
// an experimental feature gate that is off in this build, so there is no index
// to build or clear.
import type { Command } from '../../commands.js'

export function getSkillIndex(_commands: Command[]): Command[] {
  return _commands
}

export function clearSkillIndexCache(): void {}
