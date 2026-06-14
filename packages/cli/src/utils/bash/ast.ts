// TODO: tree-sitter-backed AST analysis of shell commands is out of scope (the
// native tree-sitter binding is not bundled). These carry the AST shapes the
// Bash tool's path/security validators reference; parseForSecurity reports the
// parser unavailable so callers fall back to the static-prefix path.

export type Redirect = {
  op: '>' | '>>' | '<' | '<<' | '>&' | '>|' | '<&' | '&>' | '&>>' | '<<<'
  target: string
  fd?: number
}

export type SimpleCommand = {
  /** argv[0] is the command name, rest are arguments with quotes resolved. */
  argv: string[]
  /** Leading VAR=val assignments. */
  envVars: { name: string; value: string }[]
  /** Output/input redirects. */
  redirects: Redirect[]
  /** Original source span for this command (for UI display). */
  text: string
}

export type ParseForSecurityResult =
  | { kind: 'simple'; commands: SimpleCommand[] }
  | { kind: 'too-complex'; reason: string; nodeType?: string }
  | { kind: 'parse-unavailable' }

// Without the tree-sitter binding, the AST parse is always unavailable, so
// callers take their fail-safe path (run security hooks, prompt for permission).
export async function parseForSecurity(
  _command: string,
): Promise<ParseForSecurityResult> {
  return { kind: 'parse-unavailable' }
}
