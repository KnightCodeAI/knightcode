// TODO: the per-teammate spinner line lands with the teammate subsystem.
// Renders nothing in solo mode (the only mode today).
import type * as React from 'react'
import type { InProcessTeammateTaskState } from '../../tasks/InProcessTeammateTask/types.js'

type Props = {
  teammate: InProcessTeammateTaskState
  isLast: boolean
  isSelected?: boolean
  isForegrounded?: boolean
  allIdle?: boolean
  showPreview?: boolean
}

export function TeammateSpinnerLine(_props: Props): React.ReactNode {
  return null
}
