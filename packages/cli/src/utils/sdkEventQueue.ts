// TODO: the SDK event queue feeds headless/streaming consumers (drained in
// non-interactive mode). The TUI never drains it, so enqueued events would only
// accumulate — keep it inert until the headless surface lands.

export type SdkEvent = { type: string; [key: string]: unknown }

export function enqueueSdkEvent(_event: SdkEvent): void {}

// Emit a task-terminated notification onto the SDK event stream. Inert in the
// TUI (the queue is never drained), but kept so the cancel-request hook records
// terminations through the same path the headless surface will consume.
export function emitTaskTerminatedSdk(
  taskId: string,
  status: 'completed' | 'failed' | 'stopped',
  opts?: {
    toolUseId?: string
    summary?: string
    outputFile?: string
    usage?: { total_tokens: number; tool_uses: number; duration_ms: number }
  },
): void {
  enqueueSdkEvent({
    type: 'system',
    subtype: 'task_notification',
    task_id: taskId,
    tool_use_id: opts?.toolUseId,
    status,
    output_file: opts?.outputFile ?? '',
    summary: opts?.summary ?? '',
    usage: opts?.usage,
  })
}
