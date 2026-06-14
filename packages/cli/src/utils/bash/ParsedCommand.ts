// Parsed-command abstraction the Bash tool uses to inspect pipe segments and
// output redirections. The real implementation has a tree-sitter path and a
// regex fallback; tree-sitter is out of scope, so only the inert fallback ships
// — it preserves the original command and reports no redirections / no
// tree-sitter analysis. TODO: port the regex fallback's redirection stripping
// when the bash analysis layer lands.

import type { Node } from './parser.js'
import type { TreeSitterAnalysis } from './treeSitterAnalysis.js'

export type OutputRedirection = {
  target: string
  operator: '>' | '>>'
}

export interface IParsedCommand {
  readonly originalCommand: string
  toString(): string
  getPipeSegments(): string[]
  withoutOutputRedirections(): string
  getOutputRedirections(): OutputRedirection[]
  getTreeSitterAnalysis(): TreeSitterAnalysis | null
}

class InertParsedCommand implements IParsedCommand {
  readonly originalCommand: string
  constructor(command: string) {
    this.originalCommand = command
  }
  toString(): string {
    return this.originalCommand
  }
  getPipeSegments(): string[] {
    return [this.originalCommand]
  }
  withoutOutputRedirections(): string {
    return this.originalCommand
  }
  getOutputRedirections(): OutputRedirection[] {
    return []
  }
  getTreeSitterAnalysis(): TreeSitterAnalysis | null {
    return null
  }
}

export function buildParsedCommandFromRoot(
  command: string,
  _root: Node,
): IParsedCommand {
  return new InertParsedCommand(command)
}

export const ParsedCommand = {
  async parse(command: string): Promise<IParsedCommand | null> {
    if (!command) return null
    return new InertParsedCommand(command)
  },
}
