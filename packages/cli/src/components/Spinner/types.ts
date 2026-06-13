// Minimal shapes: upstream source not recoverable from the sourcemap.
// Reconstructed from the consuming call sites (Spinner suite, REPL streamMode,
// handleMessageFromStream's onSetStreamMode).
export interface RGBColor {
  r: number
  g: number
  b: number
}

export type SpinnerMode = 'requesting' | 'responding' | 'thinking'
