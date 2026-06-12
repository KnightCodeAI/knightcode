// Frame-level types shared by the renderer facade. OpenTUI owns the actual
// frame pipeline (layout, diff, paint); these types describe the events and
// patches that the rest of the app observes.

export type FlickerReason = 'resize' | 'offscreen' | 'clear'

export type FrameEvent = {
  durationMs: number
  /** Phase breakdown in ms + patch count. Populated when the renderer
   *  has frame-timing instrumentation enabled (via onFrame wiring). */
  phases?: {
    /** renderer output: DOM → layout → screen buffer */
    renderer: number
    /** screen diff → Patch[] */
    diff: number
    /** patch merge/dedupe */
    optimize: number
    /** serialize patches → ANSI → stdout */
    write: number
    /** Pre-optimize patch count (proxy for how much changed this frame) */
    patches: number
    /** layout calculateLayout() time */
    yoga: number
    /** React reconcile time. 0 if no commit. */
    commit: number
    /** layout node visits this frame */
    yogaVisited: number
    /** measure-func (text wrap/width) calls — the expensive part */
    yogaMeasured: number
    /** early returns via layout cache */
    yogaCacheHits: number
    /** total layout node instances alive. Growth = leak. */
    yogaLive: number
  }
  flickers: Array<{
    desiredHeight: number
    availableHeight: number
    reason: FlickerReason
  }>
}

export type Patch =
  | { type: 'stdout'; content: string }
  | { type: 'clear'; count: number }
  | {
      type: 'clearTerminal'
      reason: FlickerReason
      debug?: { triggerY: number; prevLine: string; nextLine: string }
    }
  | { type: 'cursorHide' }
  | { type: 'cursorShow' }
  | { type: 'cursorMove'; x: number; y: number }
  | { type: 'cursorTo'; col: number }
  | { type: 'carriageReturn' }
  | { type: 'hyperlink'; uri: string }
  | { type: 'styleStr'; str: string }

export type Diff = Patch[]
