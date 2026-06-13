// TODO: team-memory collapsed counts land with the teammate-memory subsystem. Inert in solo mode.
import type * as React from 'react'
import type { CollapsedReadSearchGroup } from '../../types/message.js'

export function checkHasTeamMemOps(_message: CollapsedReadSearchGroup): boolean {
  return false
}

export function TeamMemCountParts(_props: {
  message: CollapsedReadSearchGroup
  isActiveGroup: boolean | undefined
  hasPrecedingParts: boolean
}): React.ReactNode {
  return null
}
