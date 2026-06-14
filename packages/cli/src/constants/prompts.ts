// TODO: the system prompt library lands with the harness phase; only the
// cache-boundary marker the API layer needs lives here.

/**
 * Marker inserted between the static and dynamic sections of the system
 * prompt so the API layer can place cache breakpoints around the stable
 * prefix.
 */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY =
  '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'

// TODO: the system-prompt assembly (persona, tool guidance, environment) lands
// with the harness phase. The /context analyzer asks for the effective prompt to
// size it; until assembly lands it contributes nothing.
import type { Tools } from '../Tool.js'

export async function getSystemPrompt(
  _tools: Tools,
  _model: string,
  _additionalWorkingDirectories?: string[],
): Promise<string[]> {
  return []
}
