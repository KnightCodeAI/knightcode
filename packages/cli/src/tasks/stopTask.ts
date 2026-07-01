// Shared logic for stopping a running task.
// Used by TaskStopTool (LLM-invoked) and SDK stop_task control request.

import type { AppState } from '../state/AppStateStore.js'
import type { SetAppState, Task, TaskStateBase, TaskType } from '../Task.js'
import { emitTaskTerminatedSdk } from '../utils/sdkEventQueue.js'
import { DreamTask } from './DreamTask/DreamTask.js'
import { InProcessTeammateTask } from './InProcessTeammateTask/InProcessTeammateTask.js'
import { LocalAgentTask } from './LocalAgentTask/LocalAgentTask.js'
import { isLocalShellTask } from './LocalShellTask/guards.js'
import { LocalShellTask } from './LocalShellTask/LocalShellTask.js'
import { killWorkflowTask } from './LocalWorkflowTask/LocalWorkflowTask.js'
import { killMonitorMcp } from './MonitorMcpTask/MonitorMcpTask.js'
import { RemoteAgentTask } from './RemoteAgentTask/RemoteAgentTask.js'

export class StopTaskError extends Error {
  constructor(
    message: string,
    public readonly code: 'not_found' | 'not_running' | 'unsupported_type',
  ) {
    super(message)
    this.name = 'StopTaskError'
  }
}

/**
 * Dispatch a task type to its implementation. Each task module owns its own
 * `kill` logic; the workflow and monitor task types expose standalone kill
 * functions rather than a full Task object, so they get lightweight adapters.
 */
function getTaskByType(type: TaskType): Pick<Task, 'kill'> | null {
  switch (type) {
    case 'local_bash':
      return LocalShellTask
    case 'local_agent':
      return LocalAgentTask
    case 'remote_agent':
      return RemoteAgentTask
    case 'in_process_teammate':
      return InProcessTeammateTask
    case 'dream':
      return DreamTask
    case 'local_workflow':
      return {
        async kill(taskId: string, setAppState: SetAppState) {
          killWorkflowTask(taskId, setAppState)
        },
      }
    case 'monitor_mcp':
      return {
        async kill(taskId: string, setAppState: SetAppState) {
          killMonitorMcp(taskId, setAppState)
        },
      }
    default:
      return null
  }
}

type StopTaskContext = {
  getAppState: () => AppState
  setAppState: (f: (prev: AppState) => AppState) => void
}

type StopTaskResult = {
  taskId: string
  taskType: string
  command: string | undefined
}

/**
 * Look up a task by ID, validate it is running, kill it, and mark it as notified.
 *
 * Throws {@link StopTaskError} when the task cannot be stopped (not found,
 * not running, or unsupported type). Callers can inspect `error.code` to
 * distinguish the failure reason.
 */
export async function stopTask(
  taskId: string,
  context: StopTaskContext,
): Promise<StopTaskResult> {
  const { getAppState, setAppState } = context
  const appState = getAppState()
  const task = appState.tasks?.[taskId] as TaskStateBase | undefined

  if (!task) {
    throw new StopTaskError(`No task found with ID: ${taskId}`, 'not_found')
  }

  if (task.status !== 'running') {
    throw new StopTaskError(
      `Task ${taskId} is not running (status: ${task.status})`,
      'not_running',
    )
  }

  const taskImpl = getTaskByType(task.type)
  if (!taskImpl) {
    throw new StopTaskError(
      `Unsupported task type: ${task.type}`,
      'unsupported_type',
    )
  }

  await taskImpl.kill(taskId, setAppState)

  // Bash: suppress the "exit code 137" notification (noise). Agent tasks: don't
  // suppress — the AbortError catch sends a notification carrying
  // extractPartialResult(agentMessages), which is the payload not noise.
  if (isLocalShellTask(task)) {
    let suppressed = false
    setAppState(prev => {
      const prevTask = prev.tasks[taskId]
      if (!prevTask || prevTask.notified) {
        return prev
      }
      suppressed = true
      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [taskId]: { ...prevTask, notified: true },
        },
      }
    })
    // Suppressing the XML notification also suppresses print.ts's parsed
    // task_notification SDK event — emit it directly so SDK consumers see
    // the task close.
    if (suppressed) {
      emitTaskTerminatedSdk(taskId, 'stopped', {
        toolUseId: task.toolUseId,
        summary: task.description,
      })
    }
  }

  const command = isLocalShellTask(task) ? task.command : task.description

  return { taskId, taskType: task.type, command }
}
