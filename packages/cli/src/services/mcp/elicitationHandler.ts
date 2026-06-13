// TODO: the MCP elicitation handler (server-driven prompts/forms) lands with the
// MCP subsystem. Only the queued-event type that AppState carries is modelled
// today; the params/result/waiting shapes are kept loose until the SDK wiring
// lands.

export type ElicitationWaitingState = {
  url?: string
  [key: string]: unknown
}

export type ElicitationRequestEvent = {
  serverName: string
  requestId: string | number
  params: Record<string, unknown>
  signal: AbortSignal
  respond: (response: Record<string, unknown>) => void
  waitingState?: ElicitationWaitingState
  onWaitingDismiss?: (action: 'dismiss' | 'retry' | 'cancel') => void
  completed?: boolean
}
