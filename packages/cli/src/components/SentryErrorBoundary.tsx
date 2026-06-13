// TODO: error reporting lands with the telemetry subsystem. This build ships no
// telemetry, so the boundary is a pass-through that renders its children.
import type * as React from 'react'

export function SentryErrorBoundary({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  return children
}
