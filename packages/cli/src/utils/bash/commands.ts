// TODO: the full bash command parser (shell-quote tokenization, heredoc
// extraction, operator splitting, redirection security analysis) lands with the
// Bash tool. The permission-message layer only needs output-redirection
// extraction for display, and only on the Bash path; until the parser is
// ported this conservatively reports no redirections (the display falls back to
// the raw command — never a security decision, which lives in the dedicated
// shell validation modules).

export function extractOutputRedirections(cmd: string): {
  commandWithoutRedirections: string
  redirections: Array<{ target: string; operator: '>' | '>>' }>
  hasDangerousRedirection: boolean
} {
  return {
    commandWithoutRedirections: cmd,
    redirections: [],
    hasDangerousRedirection: false,
  }
}
