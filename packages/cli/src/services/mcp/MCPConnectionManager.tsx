import type { ReactNode } from 'react'

// TODO: MCP connection manager — owns MCP client connections and exposes them
// to the tree. MCP is a later phase; for now this is a transparent passthrough
// that establishes no connections.

export function MCPConnectionManager(props: {
  children?: ReactNode
  [key: string]: unknown
}): ReactNode {
  return props.children ?? null
}
