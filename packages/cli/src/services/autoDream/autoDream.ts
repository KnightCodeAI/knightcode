// TODO: auto-dream (background session-memory reflection forked at turn end) is
// a separate subsystem and isn't ported. This no-op keeps the stop-hook spine's
// fire-and-forget call site intact until that feature lands.

import type { ToolUseContext } from '../../Tool.js'
import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'

type AppendSystemMessageFn = NonNullable<ToolUseContext['appendSystemMessage']>

export async function executeAutoDream(
  _context: REPLHookContext,
  _appendSystemMessage?: AppendSystemMessageFn,
): Promise<void> {}
