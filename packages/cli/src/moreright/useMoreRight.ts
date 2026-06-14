import type { ReactNode } from 'react'

// TODO: "more right" side panel — an experimental companion view. Not ported,
// so it contributes no lifecycle work and renders nothing.

export function useMoreRight(..._args: unknown[]): {
  onBeforeQuery: (..._args: unknown[]) => void
  onTurnComplete: (..._args: unknown[]) => void
  render: () => ReactNode
} {
  return {
    onBeforeQuery: () => {},
    onTurnComplete: () => {},
    render: () => null,
  }
}
