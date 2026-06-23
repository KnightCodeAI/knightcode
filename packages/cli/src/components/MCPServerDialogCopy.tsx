import React from 'react'
import { Text } from '../tui.js'

export function MCPServerDialogCopy(): React.ReactNode {
  return (
    <Text>
      MCP servers may execute code or access system resources. All tool calls
      require approval.
    </Text>
  )
}
