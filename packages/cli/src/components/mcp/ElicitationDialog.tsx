// TODO: MCP elicitation (a server asking the user to fill a form mid-tool-call)
// lands with the MCP subsystem. No MCP server is connected, so no elicitation is
// ever queued and the dialog never renders.
import type * as React from 'react'

type Props = {
  event: unknown
  onResponse: (action: any, content?: unknown) => void
  onWaitingDismiss?: (action: any) => void
  [key: string]: unknown
}

export function ElicitationDialog(_props: Props): React.ReactNode {
  return null
}
