/**
 * CLI exit helpers for subcommand handlers.
 *
 * Consolidates the "print + exit" block repeated across the `knightcode mcp *`
 * handlers. The `: never` return type lets TypeScript narrow control flow at
 * call sites without a trailing `return`.
 */
/* eslint-disable custom-rules/no-process-exit -- centralized CLI exit point */

/** Write an error message to stderr (if given) and exit with code 1. */
export function cliError(msg?: string): never {
  if (msg) process.stderr.write(msg + '\n')
  process.exit(1)
  return undefined as never
}

/** Write a message to stdout (if given) and exit with code 0. */
export function cliOk(msg?: string): never {
  if (msg) process.stdout.write(msg + '\n')
  process.exit(0)
  return undefined as never
}
