// TODO: channel permission callbacks (permission prompts over Telegram/iMessage/
// etc.) land with the MCP subsystem. Only the callback type that AppState carries
// is modelled today.

export type ChannelPermissionResponse = {
  requestId: string
  behavior: 'allow' | 'deny'
  fromServer?: string
}

export type ChannelPermissionCallbacks = {
  onResponse(
    requestId: string,
    handler: (response: ChannelPermissionResponse) => void,
  ): () => void
  resolve(
    requestId: string,
    behavior: 'allow' | 'deny',
    fromServer: string,
  ): boolean
}

// TODO: MCP permission-relay helpers (DEFERRED with MCP). No relay clients.
export function filterPermissionRelayClients(..._args: unknown[]): any[] { return [] }
export function shortRequestId(id: unknown): string { return String(id ?? '') }
export function truncateForPreview(s: unknown, ..._args: unknown[]): string { return String(s ?? '') }
