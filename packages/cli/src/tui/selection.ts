/**
 * Text selection state for fullscreen mode.
 *
 * Tracks a linear selection in screen-buffer coordinates (0-indexed col/row).
 * Selection is line-based: cells from (startCol, startRow) through
 * (endCol, endRow) inclusive, wrapping across line boundaries. This matches
 * terminal-native selection behavior (not rectangular/block).
 *
 * The selection is stored as ANCHOR (where the drag started) + FOCUS (where
 * the cursor is now). The rendered highlight normalizes to start ≤ end.
 *
 * TODO: the selection engine (drag math, screen-buffer capture, scroll-off
 * accumulation) is wired to the renderer's native selection in a later pass.
 * This module currently exports the state shape consumed by the keybinding
 * handler; the live hook (tui/hooks/use-selection) reports "no selection".
 */

type Point = { col: number; row: number }

export type SelectionState = {
  /** Where the mouse-down occurred. Null when no selection. */
  anchor: Point | null
  /** Current drag position (updated on mouse-move while dragging). */
  focus: Point | null
  /** True between mouse-down and mouse-up. */
  isDragging: boolean
  /** For word/line mode: the initial word/line bounds from the first
   *  multi-click. Drag extends from this span to the word/line at the
   *  current mouse position so the original word/line stays selected
   *  even when dragging backward past it. Null ⇔ char mode. */
  anchorSpan: { lo: Point; hi: Point; kind: 'word' | 'line' } | null
  /** Text from rows that scrolled out ABOVE the viewport during
   *  drag-to-scroll. Prepended to the on-screen text by getSelectedText. */
  scrolledOffAbove: string[]
  /** Symmetric: rows scrolled out BELOW when dragging up. Appended. */
  scrolledOffBelow: string[]
  /** Soft-wrap bits parallel to scrolledOffAbove — true means the row is a
   *  continuation of the one before it (word-wrap, not a source newline). */
  scrolledOffAboveSW: boolean[]
  /** Parallel to scrolledOffBelow. */
  scrolledOffBelowSW: boolean[]
  /** Pre-clamp anchor row. Set when shiftSelection clamps anchor so a
   *  reverse scroll can restore the true position and pop accumulators. */
  virtualAnchorRow?: number
  /** Same for focus. */
  virtualFocusRow?: number
  /** True if the mouse-down that started this selection had the alt
   *  modifier set. Used by the footer to show the right copy hint. */
  lastPressHadAlt: boolean
}

export type FocusMove =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'lineStart'
  | 'lineEnd'

export function createSelectionState(): SelectionState {
  return {
    anchor: null,
    focus: null,
    isDragging: false,
    anchorSpan: null,
    scrolledOffAbove: [],
    scrolledOffBelow: [],
    scrolledOffAboveSW: [],
    scrolledOffBelowSW: [],
    lastPressHadAlt: false,
  }
}
