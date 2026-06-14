// TODO: static PowerShell command-prefix extraction (the rule-suggestion
// counterpart to bash/prefix, via the PowerShell AST parser) is not shipped.
// Until it lands these report no static prefix, so the PowerShell permission
// dialog's rule suggestions fall back to the full command — display-only.
import type { ParsedCommandElement } from './parser.js'

export async function getCommandPrefixStatic(
  _command: string,
): Promise<{ commandPrefix: string | null } | null> {
  return null
}

export async function getCompoundCommandPrefixesStatic(
  _command: string,
  _excludeSubcommand?: (element: ParsedCommandElement) => boolean,
): Promise<string[]> {
  return []
}
