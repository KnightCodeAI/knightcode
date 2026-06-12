// TODO: only the pieces the conversation types need live here; the full SDK
// type surface (control protocol, settings, tool schemas) lands with the
// SDK entrypoint.

/**
 * Category attached to an assistant message that represents an API failure.
 * Mirrors the SDK's assistant-message error enum.
 */
export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens'

/** SDK status surfaced while long-running maintenance is in flight. */
export type SDKStatus = 'compacting' | null
