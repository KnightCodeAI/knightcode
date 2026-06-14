// TODO: static bash command-prefix extraction (used to suggest "always allow
// `git *`"-style rules) relies on the tree-sitter bash parser, which is not
// shipped. Until it lands these report no static prefix, so the bash permission
// dialog's rule suggestions fall back to the full command — a display-only
// degradation, never a security decision.

export async function getCommandPrefixStatic(
  _command: string,
  _recursionDepth = 0,
  _wrapperCount = 0,
): Promise<{ commandPrefix: string | null } | null> {
  return null
}

export async function getCompoundCommandPrefixesStatic(
  _command: string,
  _excludeSubcommand?: (subcommand: string) => boolean,
): Promise<string[]> {
  return []
}
