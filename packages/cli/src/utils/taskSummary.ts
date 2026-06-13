// TODO: background-session task summaries (generating a end-of-turn summary for
// detached/background runs) aren't implemented yet. They run behind a feature
// gate that is off in this build, so the query loop never reaches these.

import type { CacheSafeParams } from './forkedAgent.js'

export function shouldGenerateTaskSummary(): boolean {
  return false
}

export function maybeGenerateTaskSummary(_params: CacheSafeParams): void {}
