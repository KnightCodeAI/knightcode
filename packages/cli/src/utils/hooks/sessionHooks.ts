// TODO: session hooks (temporary in-memory command/prompt hooks added during a
// session and cleared when it ends) land with the hooks subsystem. Only the
// state-map type that AppState carries is modelled today.

export type SessionStore = {
  [key: string]: unknown
}

export type SessionHooksState = Map<string, SessionStore>
