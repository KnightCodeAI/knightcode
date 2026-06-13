// TODO: snip boundary rendering lands with the history-snip compaction layer.
// Gated behind a feature flag that is off in this build, so this never renders.
import type * as React from 'react'
import type { SystemMessage } from '../../types/message.js'

export function SnipBoundaryMessage(_props: {
  message: SystemMessage
}): React.ReactNode {
  return null
}
