/**
 * `knightcode agents` routing — a non-interactive listing that needs no API
 * key, so main.tsx routes it before the auth check and the interactive flag
 * parser (which would otherwise swallow `agents` as a positional prompt).
 *
 * Like `doctor`, this takes no positional sub-args; the only option is the
 * shared `--setting-sources` flag, which scopes which settings sources the
 * agent loader reads (mirrors the interactive launch path in main.tsx).
 */

import { setAllowedSettingSources } from '../bootstrap/state.js'
import { parseSettingSourcesFlag } from '../utils/settings/constants.js'

/** True when the argv invokes `knightcode agents`. */
export function isAgentsSubcommand(argv: string[]): boolean {
  return argv[2] === 'agents'
}

/** Extract `--setting-sources <value>` / `--setting-sources=<value>` from argv. */
function extractSettingSources(argv: string[]): string | undefined {
  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--setting-sources') {
      return argv[i + 1]
    }
    if (arg?.startsWith('--setting-sources=')) {
      return arg.slice('--setting-sources='.length)
    }
  }
  return undefined
}

/** Run the agents listing (handler prints the list). */
export async function runAgentsCommand(argv: string[]): Promise<void> {
  const settingSources = extractSettingSources(argv)
  if (settingSources) {
    setAllowedSettingSources(parseSettingSourcesFlag(settingSources))
  }
  const { agentsHandler } = await import('./handlers/agents.js')
  await agentsHandler()
}
