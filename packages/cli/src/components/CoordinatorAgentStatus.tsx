// TODO: the coordinator agent task panel belongs to the teammate/swarm
// orchestration subsystem and is not wired here.
import type * as React from 'react'
import type { LocalAgentTaskState } from '../tasks/LocalAgentTask/LocalAgentTask.js'

export function getVisibleAgentTasks(
  _tasks: Record<string, unknown>,
): LocalAgentTaskState[] {
  return []
}

export function useCoordinatorTaskCount(): number {
  return 0
}

export function CoordinatorTaskPanel(): React.ReactNode {
  return null
}
