// TODO: remote/SSH/direct-connect session transport — not ported. Solo local
// session only, so this reports it is not in remote mode.

export interface RemoteSessionApi {
  isRemoteMode: boolean
  cancelRequest: (..._args: unknown[]) => void
  sendMessage: (..._args: unknown[]) => void
}

export function useSSHSession(..._args: unknown[]): RemoteSessionApi {
  return {
    isRemoteMode: false,
    cancelRequest: () => {},
    sendMessage: () => {},
  }
}
