// Placeholder SDK control-protocol types; not part of the interactive surface.
export interface SDKControlCancelRequest {}
export interface SDKControlInitializeRequest {}
export interface SDKControlInitializeResponse {}
export interface SDKControlMcpSetServersResponse {}
export interface SDKControlPermissionRequest {}
export interface SDKControlReloadPluginsResponse {}
export interface SDKControlRequest {}
export interface SDKControlRequestInner {}
export interface SDKControlResponse {
  type?: string
  response: {
    request_id?: string
    subtype?: string
    response?: unknown
  }
}
export interface SDKPartialAssistantMessage {}
export interface StdinMessage {}
export interface StdoutMessage {}
