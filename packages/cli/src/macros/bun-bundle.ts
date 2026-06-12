/**
 * Stand-in for the bundler's `bun:bundle` compile-time feature-flag module,
 * which the plain runtime can't resolve. The source extractor rewrites
 * `from 'bun:bundle'` imports to point here.
 *
 * Flags are all off — the same behavior the bundler gives an unconfigured
 * build. Code guarded by `feature('...')` stays dead until a flag is
 * deliberately turned on at build time.
 */
export function feature(_flag: string): boolean {
  return false
}
