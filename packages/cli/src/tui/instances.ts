// Store all live renderer instances to ensure that consecutive render()
// calls reuse the same instance and don't create a new one.
//
// This map lives in its own file because root.ts creates instances, but the
// instance should delete itself from the map on unmount.

import type { ReactNode } from 'react'

/** A mounted terminal app: one renderer + one React root. */
export type TuiInstance = {
  render: (node: ReactNode) => void
  unmount: () => void
  waitUntilExit: () => Promise<void>
  clear: () => void
}

const instances = new Map<NodeJS.WriteStream, TuiInstance>()
export default instances
