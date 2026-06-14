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
  // Marks the previous frame contaminated so the next render is a full repaint.
  // Used on overlay unmount to avoid ghost cells from a shrunken layout.
  invalidatePrevFrame: () => void
  // External-editor handoff: release/reclaim the terminal while a subprocess
  // (vim/nano/code/…) runs. enterAlternateScreen/exitAlternateScreen are the
  // terminal-editor path (full takeover); pause/resume + suspendStdin/resumeStdin
  // are the GUI-editor path (stop rendering, leave the terminal alone).
  enterAlternateScreen: () => void
  exitAlternateScreen: () => void
  pause: () => void
  resume: () => void
  suspendStdin: () => void
  resumeStdin: () => void
}

const instances = new Map<NodeJS.WriteStream, TuiInstance>()
export default instances
