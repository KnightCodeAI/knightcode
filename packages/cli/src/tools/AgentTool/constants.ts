import { isEnvTruthy } from '../../utils/envUtils.js'

export const AGENT_TOOL_NAME = 'Agent'
// Legacy wire name for backward compat (permission rules, hooks, resumed sessions)
export const LEGACY_AGENT_TOOL_NAME = 'Task'
export const VERIFICATION_AGENT_TYPE = 'verification'

/**
 * Whether the built-in verification agent is available.
 *
 * Upstream gates this on `feature('VERIFICATION_AGENT')` + a GrowthBook flag —
 * both inert under BYOK (no bundler flags, no GrowthBook backend), which left
 * the verification agent (and the `/init-verifiers` skills it consumes) dead.
 * Under BYOK it is available on interactive (non-SDK) entrypoints, off only
 * when explicitly disabled. The agent costs tokens only when the model actually
 * spawns it, so availability itself is cheap.
 */
export function isVerificationAgentEnabled(): boolean {
  if (isEnvTruthy(process.env.KNIGHTCODE_DISABLE_VERIFICATION_AGENT)) {
    return false
  }
  return (
    process.env.KNIGHTCODE_CODE_ENTRYPOINT !== 'sdk-ts' &&
    process.env.KNIGHTCODE_CODE_ENTRYPOINT !== 'sdk-py' &&
    process.env.KNIGHTCODE_CODE_ENTRYPOINT !== 'sdk-cli'
  )
}

// Built-in agents that run once and return a report — the parent never
// SendMessages back to continue them. Skip the agentId/SendMessage/usage
// trailer for these to save tokens (~135 chars × 34M Explore runs/week).
export const ONE_SHOT_BUILTIN_AGENT_TYPES: ReadonlySet<string> = new Set([
  'Explore',
  'Plan',
])
