import { isEnvTruthy } from './envUtils.js'

/**
 * Centralized runtime check for agent teams/teammate features.
 * This is the single gate that should be checked everywhere teammates
 * are referenced (prompts, code, tools isEnabled, UI, etc.).
 *
 * Agent teams are available to every user in this build. The upstream
 * ant-only / experimental-flag / GrowthBook-killswitch gating has been
 * removed so TeamCreate/TeamDelete/SendMessage and in-process teammate
 * spawning work out of the box.
 *
 * An explicit opt-out is still honored: set KNIGHTCODE_CODE_DISABLE_AGENT_TEAMS
 * to turn the feature off (e.g. for environments that can't host teammates).
 */
export function isAgentSwarmsEnabled(): boolean {
  if (isEnvTruthy(process.env.KNIGHTCODE_CODE_DISABLE_AGENT_TEAMS)) {
    return false
  }
  return true
}
