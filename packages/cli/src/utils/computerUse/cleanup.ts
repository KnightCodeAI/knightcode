// TODO: computer-use session cleanup (tearing down a browser-control session at
// the end of a turn) isn't implemented yet. It runs behind a feature gate that
// is off in this build; with no computer-use sessions there is nothing to clean
// up.

import type { ToolUseContext } from '../../Tool.js'

export async function cleanupComputerUseAfterTurn(
  _ctx: Pick<
    ToolUseContext,
    'getAppState' | 'setAppState' | 'sendOSNotification'
  >,
): Promise<void> {}
