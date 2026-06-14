// TODO: in-process teammate task (agent swarm) — out of scope, inert stub.
import type { InProcessTeammateTaskState } from './types.js'

export const InProcessTeammateTask = {
  kill(_taskId: unknown, _setAppState: unknown): Promise<void> {
    return Promise.resolve();
  },
};

export function getRunningTeammatesSorted(_tasks: Record<string, unknown>): any[] { return [] }

// All in-process teammate tasks in the task map. Solo mode has none, so this is
// always empty.
export function getAllInProcessTeammateTasks(
  _tasks: Record<string, unknown>,
): InProcessTeammateTaskState[] {
  return []
}
