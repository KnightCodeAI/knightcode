// TODO: unix-domain-socket client — enumerates live background/daemon sessions
// for the concurrent-session IPC layer (not ported). With no daemon, there are
// no live peers, so the listing is empty and every session is continuable.

export interface LiveSessionInfo {
  sessionId?: string
  kind?: 'interactive' | 'bg' | 'daemon' | string
}

export async function listAllLiveSessions(): Promise<LiveSessionInfo[]> {
  return []
}
