// TODO: the teammate/swarm spinner tree lands with the teammate subsystem.
// Renders nothing in solo mode (the only mode today).
import type * as React from 'react'

type Props = {
  selectedIndex?: number
  isInSelectionMode?: boolean
  allIdle?: boolean
  leaderVerb?: string
  leaderTokenCount?: number
  leaderIdleText?: string
}

export function TeammateSpinnerTree(_props: Props): React.ReactNode {
  return null
}
