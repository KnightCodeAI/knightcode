import { useMemo } from 'react'

export type FocusMove = 'left' | 'right' | 'up' | 'down'

export type SelectionState = {
  isDragging: boolean
  // True when the most recent mouse-press carried the Alt modifier. Read on
  // macOS to detect a failed alt+click (the footer's copy-on-select hint).
  lastPressHadAlt: boolean
}

/**
 * Access to text selection operations (fullscreen only).
 *
 * TODO: wire to OpenTUI's native selection (renderer.getSelection() /
 * Renderable.selectable) — until then this reports "no selection", which is
 * also the upstream behavior outside alt-screen mode.
 */
export function useSelection(): {
  copySelection: () => string
  /** Copy without clearing the highlight (for copy-on-select). */
  copySelectionNoClear: () => string
  clearSelection: () => void
  hasSelection: () => boolean
  /** Read the raw mutable selection state (for drag-to-scroll). */
  getState: () => SelectionState | null
  /** Subscribe to selection mutations (start/update/finish/clear). */
  subscribe: (cb: () => void) => () => void
  /** Shift the anchor row by dRow, clamped to [minRow, maxRow]. */
  shiftAnchor: (dRow: number, minRow: number, maxRow: number) => void
  /** Shift anchor AND focus by dRow (keyboard scroll). */
  shiftSelection: (dRow: number, minRow: number, maxRow: number) => void
  /** Keyboard selection extension (shift+arrow). */
  moveFocus: (move: FocusMove) => void
  /** Capture text from rows about to scroll out of the viewport. */
  captureScrolledRows: (
    firstRow: number,
    lastRow: number,
    side: 'above' | 'below',
  ) => void
  /** Set the selection highlight bg color (theme-piping). */
  setSelectionBgColor: (color: string) => void
} {
  return useMemo(
    () => ({
      copySelection: () => '',
      copySelectionNoClear: () => '',
      clearSelection: () => {},
      hasSelection: () => false,
      getState: () => null,
      subscribe: () => () => {},
      shiftAnchor: () => {},
      shiftSelection: () => {},
      moveFocus: () => {},
      captureScrolledRows: () => {},
      setSelectionBgColor: () => {},
    }),
    [],
  )
}

/**
 * Reactive selection-exists state. Always false until selection is wired
 * to the renderer (see useSelection).
 */
export function useHasSelection(): boolean {
  return false
}
