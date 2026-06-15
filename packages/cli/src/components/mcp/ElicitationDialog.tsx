// TODO: MCP elicitation (a server asking the user to fill a form mid-tool-call)
// lands with the MCP subsystem. No MCP server is connected, so no elicitation is
// ever queued and the dialog never renders.
import type * as React from 'react'
import type { ElicitResult } from '@modelcontextprotocol/sdk/types.js'

type Props = {
  event: unknown
  onResponse: (
    action: ElicitResult['action'],
    content?: ElicitResult['content'],
  ) => void
  onWaitingDismiss?: (action: 'dismiss' | 'retry' | 'cancel') => void
  [key: string]: unknown
}

export function ElicitationDialog(_props: Props): React.ReactNode {
  return null
}
