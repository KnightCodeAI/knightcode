// TODO: prompt suggestion (background fork that proposes next-step prompts after
// a turn) is a separate subsystem and isn't ported. This no-op keeps the
// stop-hook spine's fire-and-forget call site intact until that feature lands.

import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'

export async function executePromptSuggestion(
  _context: REPLHookContext,
): Promise<void> {}

// Prompt suggestion is off until the subsystem lands.
export function shouldEnablePromptSuggestion(): boolean {
  return false
}

// Prompt suggestion is inert (see above); aborting an in-flight suggestion and
// logging a suppression are no-ops until the subsystem lands.
export function abortPromptSuggestion(): void {}

export function logSuggestionSuppressed(
  _reason: string,
  _suggestion?: string,
  _promptId?: string,
  _source?: 'cli' | 'sdk',
): void {}
