// TODO: the full application state slice (settings, mode, queues, background
// task registry, …) lands with the harness. The tool context threads AppState
// through getAppState/setAppState; only the permission slice tools read today
// is typed — the rest stays open until the real store ports.

import type { ToolPermissionContext } from '../Tool.js'
import type { TodoList } from '../utils/todo/types.js'

export type AppState = {
  toolPermissionContext: ToolPermissionContext
  /** Session/agent task checklists, keyed by agentId (or session id for the main thread). */
  todos: Record<string, TodoList>
  [key: string]: unknown
}
