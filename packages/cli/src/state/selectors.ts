// TODO: teammate/swarm view selectors (resolving which teammate's transcript is
// currently being viewed) are not implemented yet. The attachment pipeline reads
// the viewed teammate's identity to address its mailbox; until the swarm
// subsystem lands no teammate is ever being viewed.
import type { AppState } from './AppState.js'

type ViewedTeammateTask = {
  identity: { agentName: string }
}

export function getViewedTeammateTask(
  _appState: AppState,
): ViewedTeammateTask | undefined {
  return undefined
}
