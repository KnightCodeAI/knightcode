// TODO: remote session manager — owned by the knightcode.raghavseth.in remote-control
// feature. Types only; the local-only build never opens a remote session.
export type RemoteSessionConfig = {
  sessionId: string
  getAccessToken: () => string
  orgUuid: string
  /** True if session was created with an initial prompt that's being processed */
  hasInitialPrompt?: boolean
  /**
   * When true, this client is a pure viewer. Ctrl+C/Escape do NOT send
   * interrupt to the remote agent; 60s reconnect timeout is disabled;
   * session title is never updated.
   */
  viewerOnly?: boolean
}
