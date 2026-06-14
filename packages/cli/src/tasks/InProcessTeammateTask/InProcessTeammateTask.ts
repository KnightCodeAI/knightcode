// TODO: in-process teammate task (agent swarm) — out of scope, inert stub.
export const InProcessTeammateTask = {
  kill(_taskId: unknown, _setAppState: unknown): Promise<void> {
    return Promise.resolve();
  },
};

export function getRunningTeammatesSorted(_tasks: Record<string, unknown>): any[] { return [] }
