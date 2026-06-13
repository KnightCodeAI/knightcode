import type {
  LocalShellSpawnInput,
  SetAppState,
  TaskContext,
  TaskHandle,
} from '../../Task.js'
import type { ShellCommand } from '../../utils/ShellCommand.js'

// The background-task framework (task registry, AppState task records, kill
// dispatch, message-queue notifications) lands with the harness. Until then
// only the foreground execution path is wired: a command that completes within
// the progress threshold never touches any of these. The seam below keeps
// PowerShellTool unchanged when the framework lands, so it can drop in
// without touching the tool.

const BACKGROUND_DEFERRED =
  'Background shell tasks are not available yet — the task framework lands with the harness.'

/** Spawn a backgrounded shell task. Requires the task framework (deferred). */
export async function spawnShellTask(
  _input: LocalShellSpawnInput & { shellCommand: ShellCommand },
  _context: TaskContext,
): Promise<TaskHandle> {
  throw new Error(BACKGROUND_DEFERRED)
}

/**
 * Register a still-running foreground task so it can be backgrounded later.
 * The AppState task registry is deferred; returning the stable task id keeps
 * the caller's bookkeeping intact so foreground commands run unaffected.
 */
export function registerForeground(
  input: LocalShellSpawnInput & { shellCommand: ShellCommand },
  _setAppState: SetAppState,
  _toolUseId?: string,
): string {
  return input.shellCommand.taskOutput.taskId
}

/** Drop a foreground task on completion. No-op until the registry exists. */
export function unregisterForeground(
  _taskId: string,
  _setAppState: SetAppState,
): void {}

/** Mark a backgrounded task as notified. No-op until the registry exists. */
export function markTaskNotified(
  _taskId: string,
  _setAppState: SetAppState,
): void {}

/**
 * Background a task that is already registered in the foreground. Without the
 * task framework there is nothing to promote, so report failure; the caller
 * falls back gracefully (the command keeps running in the foreground).
 */
export function backgroundExistingForegroundTask(
  _taskId: string,
  _shellCommand: ShellCommand,
  _description: string,
  _setAppState: SetAppState,
  _toolUseId?: string,
): boolean {
  return false
}
