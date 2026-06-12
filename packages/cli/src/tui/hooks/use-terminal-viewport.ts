import { useCallback, useContext, useLayoutEffect, useRef } from 'react'
import { TerminalSizeContext } from '../components/TerminalSizeContext.js'
import type { DOMElement } from '../dom.js'

type ViewportEntry = {
  /**
   * Whether the element is currently within the terminal viewport
   */
  isVisible: boolean
}

/**
 * Hook to detect if a component is within the terminal viewport.
 *
 * Returns a callback ref and a viewport entry object.
 * Attach the ref to the component you want to track.
 *
 * The entry is updated during the layout phase (useLayoutEffect) so callers
 * always read fresh values during render. Visibility changes do NOT trigger
 * re-renders on their own — callers that re-render for other reasons (e.g.
 * animation ticks, state changes) will pick up the latest value naturally.
 */
export function useTerminalViewport(): [
  ref: (element: DOMElement | null) => void,
  entry: ViewportEntry,
] {
  const terminalSize = useContext(TerminalSizeContext)
  const elementRef = useRef<DOMElement | null>(null)
  const entryRef = useRef<ViewportEntry>({ isVisible: true })

  const setElement = useCallback((el: DOMElement | null) => {
    elementRef.current = el
  }, [])

  // Runs on every render because layout values can change without React
  // being aware. Only updates the ref — no setState to avoid cascading
  // re-renders during the commit phase. OpenTUI renderables expose their
  // resolved screen position directly (y is absolute, scroll offsets
  // already applied by the scrollbox).
  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element || !terminalSize) {
      return
    }

    const top = element.y
    const bottom = top + element.height
    const visible = bottom > 0 && top < terminalSize.rows

    if (visible !== entryRef.current.isVisible) {
      entryRef.current = { isVisible: visible }
    }
  })

  return [setElement, entryRef.current]
}
