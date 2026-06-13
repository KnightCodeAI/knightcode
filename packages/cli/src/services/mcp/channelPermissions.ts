// TODO: channel permission callbacks (permission prompts over Telegram/iMessage/
// etc.) land with the MCP subsystem. Only the callback type that AppState carries
// is modelled today.

export type ChannelPermissionResponse = {
  requestId: string
  behavior: 'allow' | 'deny'
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
