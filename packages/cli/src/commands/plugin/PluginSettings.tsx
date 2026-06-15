// TODO: plugin management UI (the unified plugin/MCP settings panel) is not
// ported — the plugin system is a later deliverable. Inert: /mcp renders the
// MCP settings panel directly; the plugin-redirect branch is dead in this build.

import type * as React from 'react'

export function PluginSettings(_props: {
  onComplete: (result?: string) => void
  args?: string
  showMcpRedirectMessage?: boolean
  [key: string]: unknown
}): React.ReactNode {
  return null
}
