// TODO: the full application state slice (settings, mode, queues, background
// task registry, …) lands with the harness. The tool context threads AppState
// through getAppState/setAppState; only an open shape lives here until the
// real store ports.

export type AppState = {
  [key: string]: unknown
}
