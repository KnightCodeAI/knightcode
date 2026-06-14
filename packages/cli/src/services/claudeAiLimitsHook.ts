// TODO: Claude.ai usage-limit polling is out of scope; BYOK builds have no
// managed account limits. The hook returns the inert default limits state.
import { type ClaudeAILimits, currentLimits } from './claudeAiLimits.js'

export function useClaudeAiLimits(): ClaudeAILimits {
  return currentLimits
}
