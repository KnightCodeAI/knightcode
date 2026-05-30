export interface TaskNotificationFields {
  taskId: string;
  description: string;
  status: "completed" | "failed" | "killed";
  finalMessage?: string;
  error?: string;
  outputFile?: string;
  usage?: { totalTokens: number; toolUses: number; durationMs: number };
}

export function buildTaskNotification(f: TaskNotificationFields): string {
  const summary =
    f.status === "completed"
      ? `Agent "${f.description}" completed`
      : f.status === "failed"
        ? `Agent "${f.description}" failed: ${f.error || "Unknown error"}`
        : `Agent "${f.description}" was stopped`;
  const result = f.finalMessage ? `\n<result>${f.finalMessage}</result>` : "";
  const usage = f.usage
    ? `\n<usage><total_tokens>${f.usage.totalTokens}</total_tokens><tool_uses>${f.usage.toolUses}</tool_uses><duration_ms>${f.usage.durationMs}</duration_ms></usage>`
    : "";
  const outputFile = f.outputFile
    ? `\n<output_file>${f.outputFile}</output_file>`
    : "";
  return `<task_notification>
<task_id>${f.taskId}</task_id>${outputFile}
<status>${f.status}</status>
<summary>${summary}</summary>${result}${usage}
</task_notification>`;
}

// Module-level FIFO queue with notified-dedup (mirrors enqueueAgentNotification).
const queue: Array<{ taskId: string; message: string }> = [];
const notified = new Set<string>();

export function enqueueNotification(taskId: string, message: string): void {
  if (notified.has(taskId)) return;
  notified.add(taskId);
  queue.push({ taskId, message });
}

/** Remove and return the single oldest queued notification message, if any. */
export function dequeueNotification(): string | undefined {
  return queue.shift()?.message;
}

export function drainNotifications(): string[] {
  const msgs = queue.map((q) => q.message);
  queue.length = 0;
  return msgs;
}

export function hasNotifications(): boolean {
  return queue.length > 0;
}

export function resetNotifications(): void {
  queue.length = 0;
  notified.clear();
}
