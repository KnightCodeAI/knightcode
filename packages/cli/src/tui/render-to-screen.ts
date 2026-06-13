// Position of a search match within a rendered message, in screen cells.
// TODO: the off-screen render + position scan helpers (renderToScreen,
// scanPositions, applyPositionedHighlight) land with the transcript-search
// rendering layer; only the position shape is consumed today.
export type MatchPosition = {
  row: number
  col: number
  /** Number of CELLS the match spans (= query.length for ASCII, more
   *  for wide chars in the query). */
  len: number
}
