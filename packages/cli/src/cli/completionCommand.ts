/**
 * `knightcode completion <shell> [--output <file>]` routing — generates a shell
 * completion script. Non-interactive and API-key-free, so main.tsx routes it
 * before the auth check and the interactive flag parser (which would otherwise
 * swallow `completion` as a positional prompt).
 */

/** True when the argv invokes `knightcode completion`. */
export function isCompletionSubcommand(argv: string[]): boolean {
  return argv[2] === 'completion'
}

/** Extract `--output <value>` / `--output=<value>` from argv (after the shell arg). */
function extractOutput(argv: string[]): string | undefined {
  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--output' || arg === '-o') {
      return argv[i + 1]
    }
    if (arg?.startsWith('--output=')) {
      return arg.slice('--output='.length)
    }
  }
  return undefined
}

/**
 * Run the completion generator. The shell is the first positional after
 * `completion`; an absent/option-looking value is treated as missing so the
 * handler reports the supported shells.
 */
export async function runCompletionCommand(
  argv: string[],
  version: string,
): Promise<void> {
  const shellArg = argv[3]
  const shell = shellArg && !shellArg.startsWith('-') ? shellArg : ''
  const { completionHandler } = await import('./handlers/completion.js')
  await completionHandler(shell, { output: extractOutput(argv) }, version)
}
