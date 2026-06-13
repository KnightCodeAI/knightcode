// TODO: prompt suggestion (background fork that proposes next-step prompts after
// a turn) is a separate subsystem and isn't ported. This no-op keeps the
// stop-hook spine's fire-and-forget call site intact until that feature lands.

import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'

export async function executePromptSuggestion(
  _context: REPLHookContext,
): Promise<void> {}
