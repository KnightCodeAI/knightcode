// TODO: IDE connection status belongs to the IDE integration subsystem; the
// hook reports no connected IDE.
export type IdeStatus = 'connected' | 'disconnected' | 'pending' | null

export function useIdeConnectionStatus(_mcpClients?: unknown[]): {
  status: IdeStatus
  ideName: string | null
} {
  return { status: null, ideName: null }
}
