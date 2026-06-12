// TODO: the full SDK utility-type surface lands with the SDK entrypoint;
// only the usage helper type consumed by the API layer lives here.

import type { BetaUsage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/**
 * Usage with every nullable field resolved, for accumulators that always
 * write concrete numbers.
 */
export type NonNullableUsage = {
  [K in keyof BetaUsage]-?: NonNullable<BetaUsage[K]>
}
