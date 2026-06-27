/**
 * Stand-in for the bundler's `bun:bundle` compile-time feature-flag module,
 * which the plain runtime can't resolve. The source extractor rewrites
 * `from 'bun:bundle'` imports to point here.
 *
 * Flags are off by default — the same behavior the bundler gives an
 * unconfigured build. Code guarded by `feature('...')` stays dead until a flag
 * is deliberately turned on here.
 *
 * TRANSCRIPT_CLASSIFIER is enabled in this build: it lights up "auto mode",
 * whose decision pipeline (classifier, carousel entry, opt-in dialog) is
 * already implemented and gated entirely on this flag.
 */
const ENABLED_FLAGS = new Set<string>(['TRANSCRIPT_CLASSIFIER'])

export function feature(flag: string): boolean {
  return ENABLED_FLAGS.has(flag)
}
