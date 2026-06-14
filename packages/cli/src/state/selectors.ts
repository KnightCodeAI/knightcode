// TODO: teammate/swarm view selectors (resolving which teammate's transcript is
// currently being viewed) are not implemented yet. The attachment pipeline reads
// the viewed teammate's identity to address its mailbox; until the swarm
// subsystem lands no teammate is ever being viewed.
import type { LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js'
import type { InProcessTeammateTaskState } from '../tasks/InProcessTeammateTask/types.js'
import type { AppState } from './AppState.js'

export function getViewedTeammateTask(
  _appState: any,
): InProcessTeammateTaskState | undefined {
  return undefined
}

// Return type for getActiveAgentForInput: where user input is routed.
export type ActiveAgentForInput =
  | { type: 'leader' }
  | { type: 'viewed'; task: InProcessTeammateTaskState }
  | { type: 'named_agent'; task: LocalAgentTaskState }

// Solo mode: input always routes to the leader. The viewed/named-agent branches
// activate with the teammate/swarm subsystem.
export function getActiveAgentForInput(
  _appState: AppState,
): ActiveAgentForInput {
  return { type: 'leader' }
}
