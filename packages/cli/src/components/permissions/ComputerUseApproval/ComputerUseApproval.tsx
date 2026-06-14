// TODO: computer-use is out of scope; the approval dialog (app allowlist /
// macOS TCC panel) is never reached because no computer-use request is ever
// raised. Renders nothing.
import type * as React from 'react'

export function ComputerUseApproval(_props: {
  request: unknown
  onDone: (response: unknown) => void
}): React.ReactNode {
  return null
}
