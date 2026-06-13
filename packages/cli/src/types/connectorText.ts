// TODO: connector text is a beta block type not yet in the SDK; the shapes
// were reconstructed from the stream-accumulation code that consumes them.

/** Streamed block carrying connector-surfaced text (beta, not in SDK types). */
export type ConnectorTextBlock = {
  type: 'connector_text'
  connector_text: string
  signature?: string
}

export type ConnectorTextDelta = {
  type: 'connector_text_delta'
  connector_text: string
  signature?: string
}

export function isConnectorTextBlock(param: {
  type: string
}): param is ConnectorTextBlock {
  return param.type === 'connector_text'
}
