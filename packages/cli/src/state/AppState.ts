// TODO: the full application state slice (settings, mode, queues, background
// task registry, …) lands with the harness. The tool context threads AppState
// through getAppState/setAppState; only the permission slice tools read today
// is typed — the rest stays open until the real store ports.

import type { ToolPermissionContext } from '../Tool.js'

export type AppState = {
  toolPermissionContext: ToolPermissionContext
  [key: string]: unknown
}
