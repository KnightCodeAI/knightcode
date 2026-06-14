// TODO: the remote-session callout is out of scope (remote/ssh sessions).
import type * as React from 'react'

export function shouldShowRemoteCallout(): boolean {
  return false
}

export function RemoteCallout(_props: {
  onDone: (reason: string) => void
}): React.ReactNode {
  return null
}
