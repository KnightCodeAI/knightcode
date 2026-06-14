// TODO: OS sandboxing is out of scope; the network-host approval prompt is never
// raised because no sandbox violation occurs. Renders nothing.
import type * as React from 'react'

export type SandboxPermissionRequestProps = {
  hostPattern: unknown
  onUserResponse: (response: { allow: boolean; persistToSettings: boolean }) => void
}

export function SandboxPermissionRequest(
  _props: SandboxPermissionRequestProps,
): React.ReactNode {
  return null
}
