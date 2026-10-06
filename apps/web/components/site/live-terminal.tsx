"use client"

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

/* ---------------------------------------------------------------------------
 * Palette: packages/cli/src/modes/interactive/theme/dark.json, resolved.
 * The TUI owns its own colours, so this panel stays dark in both site themes -
 * exactly what the terminal shows.
 * ------------------------------------------------------------------------- */
const C = {
  pageBg: "#16130f",
  text: "#e7e2db",
  muted: "#9c958d",
  dim: "#7b756e",
  accent: "#ff8a3d",
  success: "#8fb573",
  error: "#ea6f59",
  warning: "#e9c46a",
  border: "#4a443e",
  borderMuted: "#36312c",
  userMsgBg: "#26221f",
  toolTitle: "#e7e2db",
  toolOutput: "#9c958d",
  bashMode: "#8fb573",
  mdHeading: "#ffb870",
  mdCode: "#ffb870",
  mdListBullet: "#ff8a3d",
  diffAdded: "#8fb573",
  diffRemoved: "#ea6f59",
  diffContext: "#9c958d",
  synComment: "#7b756e",
  synKeyword: "#ff8a3d",
  synFunction: "#ffb870",
  synString: "#8fb573",
  synNumber: "#f2a65a",
  synType: "#e9c46a",
  synVariable: "#d9c2a8",
} as const

/* Glyph vocabulary: packages/cli/src/modes/interactive/glyphs.ts (non-darwin set). */
const BULLET = "●"
const BLOCK_INDENT = "  "
const RESULT_GUTTER = "  ⎿  "
const RESULT_INDENT = "     "
const USER_GUTTER = "❯ "
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const SPINNER_MS = 80

/** modes/interactive/spinner-verbs.ts: one is drawn per prompt. */
const SPINNER_VERBS = ["Accomplishing","Actualizing","Architecting","Armoring","Baking","Besieging","Bootstrapping","Brewing","Burrowing","Calculating","Cantering","Caramelizing","Cascading","Castling","Catapulting","Cerebrating","Channeling","Checkmating","Choreographing","Churning","Coalescing","Cogitating","Combobulating","Composing","Computing","Concocting","Considering","Contemplating","Cooking","Crafting","Creating","Crunching","Crystallizing","Cultivating","Deciphering","Deliberating","Determining","Dragon-slaying","Drawbridging","Dubbing","Elucidating","Embellishing","En-passanting","Enchanting","Envisioning","Fermenting","Fianchettoing","Finagling","Forging","Forking","Galloping","Gambiting","Generating","Germinating","Grail-seeking","Harmonizing","Hashing","Hatching","Heralding","Herding","Ideating","Imagining","Improvising","Incubating","Inferring","Infusing","Jousting","Kneading","Knighting","L-hopping","Lancing","Manifesting","Marinating","Metamorphosing","Moat-hopping","Mulling","Musing","Mustering","Noodling","Orchestrating","Outflanking","Parrying","Pawn-promoting","Percolating","Perusing","Philosophising","Pondering","Pouncing","Prestidigitating","Processing","Propagating","Puzzling","Questing","Rallying","Reticulating","Rook-lifting","Ruminating","Saddling","Sallying","Scouting","Scurrying","Simmering","Sketching","Spelunking","Spinning","Sprouting","Squiring","Stewing","Strategizing","Swashbuckling","Swooping","Synthesizing","Tempering","Thinking","Tilting","Tinkering","Transfiguring","Transmuting","Trotting","Troubadouring","Unfurling","Unravelling","Vanquishing","Whirring","Working","Wrangling"] // prettier-ignore
const pickVerb = () =>
  `${SPINNER_VERBS[Math.floor(Math.random() * SPINNER_VERBS.length)]}…`

/** The knight, verbatim from extensions/ui/index.ts, trailing cells included. */
const LOGO = [
  "      ▄███▄▄     ",
  "  ▄▄█████████▄▄  ",
  "▀███▀▀▀█████████ ",
  "    ▄███████████ ",
  "   ██████████▀▀  ",
  "  ███████████▄▄  ",
  "  ▀▀▀▀▀▀▀▀▀▀▀▀▀  ",
]
const LOGO_WIDTH = 17
const LOGO_GAP = 3

/**
 * The header's dark ramp: PALETTES.dark in extensions/ui/index.ts, mixed in
 * oklch and sampled at 64 steps exactly as RAMPS is, then stored as RGB.
 */
const RAMP: ReadonlyArray<readonly [number, number, number]> = [[255,208,138],[255,206,135],[255,205,131],[255,203,128],[255,201,125],[255,200,122],[255,198,118],[255,196,115],[255,195,111],[255,193,108],[255,191,104],[255,189,101],[255,188,97],[255,186,94],[255,184,90],[255,182,86],[255,180,82],[255,178,78],[255,177,74],[255,175,70],[255,173,66],[255,171,61],[255,168,58],[255,166,56],[255,163,53],[255,160,50],[255,157,47],[255,154,44],[255,152,42],[255,149,39],[255,146,36],[255,143,33],[255,140,30],[255,137,27],[255,133,24],[255,130,21],[255,127,18],[255,124,14],[255,120,11],[255,117,8],[255,113,5],[255,110,2],[255,106,0],[254,104,1],[252,103,2],[251,101,3],[249,100,4],[248,98,5],[246,97,6],[245,95,7],[243,94,8],[242,92,9],[240,91,10],[239,89,11],[237,88,12],[236,86,13],[234,85,14],[233,83,14],[231,82,15],[230,80,16],[228,79,16],[227,77,17],[226,76,17],[224,74,18]] // prettier-ignore
const HIGHLIGHT = [255, 244, 224] as const
const FLOW_SECONDS = 5
const GLINT_SWEEP_SECONDS = 1.6
const GLINT_DELAY_MS = 1000

/** shimmer() from extensions/ui/index.ts: the colour at `x` columns and `y`
 *  half-rows, `time` seconds into the glint. */
function shimmer(x: number, y: number, time: number): string {
  const diagonal = x + y
  const wave =
    0.5 - 0.5 * Math.cos(2 * Math.PI * (diagonal / 40 - time / FLOW_SECONDS))
  const base = RAMP[Math.round(wave * (RAMP.length - 1))]!
  const sweep = time / GLINT_SWEEP_SECONDS
  const glow = Math.exp(-(((diagonal - (sweep * 60 - 10)) / 3) ** 2))
  const mixed =
    glow < 0.01
      ? base
      : base.map((c, i) => c + (HIGHLIGHT[i]! - c) * glow * 0.8)
  return `rgb(${mixed.map(Math.round).join(",")})`
}

/** core/slash-commands.ts, in registry order. */
const SLASH_COMMANDS: Array<{ name: string; description: string }> = [
  { name: "settings", description: "Open settings menu" },
  {
    name: "model",
    description: "<provider/model> — Select model (opens selector UI)",
  },
  { name: "tree", description: "Navigate session tree (switch branches)" },
  { name: "thinking", description: "<level> — Set thinking level" },
  {
    name: "scoped-models",
    description: "Enable/disable models for Ctrl+P cycling",
  },
  {
    name: "export",
    description: "Export session (HTML default, or specify path: .html/.jsonl)",
  },
  {
    name: "import",
    description: "Import and resume a session from a JSONL file",
  },
  { name: "share", description: "Share session as a secret GitHub gist" },
  {
    name: "bug",
    description: "<description> — Report a bug to the KnightCode developers",
  },
  { name: "copy", description: "Copy last agent message to clipboard" },
  { name: "name", description: "Set session display name" },
  { name: "session", description: "Show session info and stats" },
  { name: "changelog", description: "Show changelog entries" },
  { name: "hotkeys", description: "Show all keyboard shortcuts" },
  {
    name: "fork",
    description: "Create a new fork from a previous user message",
  },
  {
    name: "clone",
    description: "Duplicate the current session at the current position",
  },
  {
    name: "trust",
    description: "Save project trust decision for future sessions",
  },
  {
    name: "login",
    description: "<provider> — Configure provider authentication",
  },
  { name: "logout", description: "Remove provider authentication" },
  { name: "new", description: "Start a new session" },
  { name: "compact", description: "Manually compact the session context" },
  { name: "resume", description: "Resume a different session" },
  {
    name: "reload",
    description:
      "Reload keybindings, extensions, skills, prompts, themes, and context files",
  },
  { name: "quit", description: "Quit knightcode" },
]

/** What `@` completes against. A plausible slice of this repo. */
const FILES = [
  "packages/cli/src/core/tools/bash.ts",
  "packages/cli/src/core/tools/edit.ts",
  "packages/cli/src/core/agent-session.ts",
  "packages/cli/src/core/keybindings.ts",
  "packages/cli/src/modes/interactive/interactive-mode.ts",
  "packages/tui/src/components/editor.ts",
  "packages/ai/src/providers/anthropic.ts",
  "AGENTS.md",
  "README.md",
]

const AUTOCOMPLETE_MAX_VISIBLE = 5

/** Beat 2 picks this file out of the `@` menu: the token it types, and how far
 *  down the filtered list that lands. Derived from FILES, so reordering the
 *  list can never desync the walk from the entry it stops on. */
const MENTION = "packages/cli/src/core/agent-session.ts"
const MENTION_QUERY = "core"
const MENTION_INDEX = FILES.filter((p) => p.includes(MENTION_QUERY)).indexOf(
  MENTION
)

/* ---------------------------------------------------------------------------
 * Row model. A row is a gutter (never wraps) plus content (wraps under itself),
 * which is what Gutter does in the TUI.
 * ------------------------------------------------------------------------- */
type Span = {
  t: string
  c?: string
  b?: boolean
  inverse?: boolean
  /** An animated spinner frame in place of `t`, as Loader draws it. */
  spin?: boolean
}
type Row = {
  id: number
  gutter?: Span[]
  spans: Span[]
  bg?: string
  /** Output padding: the one-column right margin of user and assistant text. */
  margin?: boolean
  /** Session banner: the ui extension's KnightHeader. */
  banner?: { version: string }
}

const s = (t: string, c?: string, b?: boolean): Span => ({ t, c, b })
const blank = (): Span[] => [s("")]
/** showStatus()'s 1-column pad: a gutter, so wrapped text stays indented. */
const PAD: Span[] = [s(" ")]
/** Assistant text hangs at the column tool calls and prompts start their text. */
const INDENT: Span[] = [s(BLOCK_INDENT)]

/** keyHint(): the key dim, the description muted. Joined with a non-breaking
 *  space so a wrap lands between hints, never inside one. */
const hint = (key: string, description: string): Span[] => [
  s(key, C.dim),
  s(` ${description}`, C.muted),
]

/** Loader's frame counter, one braille frame per 80ms. */
function useSpinnerFrame(): number {
  const reduceMotion = useReducedMotion()
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (reduceMotion) return
    const id = setInterval(() => setFrame((f) => f + 1), SPINNER_MS)
    return () => clearInterval(id)
  }, [reduceMotion])
  return frame
}

function Spinner() {
  return <>{SPINNER[useSpinnerFrame() % SPINNER.length]}</>
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((span, i) => {
        const style: CSSProperties = span.inverse
          ? { color: C.pageBg, background: C.text }
          : { color: span.c ?? C.text }
        if (span.b) style.fontWeight = 600
        return (
          <span key={i} style={style}>
            {span.spin ? <Spinner /> : span.t}
          </span>
        )
      })}
    </>
  )
}

const RowView = memo(function RowView({ row }: { row: Row }) {
  if (row.banner) return <Banner version={row.banner.version} />

  return (
    <div
      className={cn("flex min-h-[1.45em] w-full", row.margin && "pr-[1ch]")}
      style={row.bg ? { background: row.bg } : undefined}
    >
      {row.gutter && (
        <span className="shrink-0 whitespace-pre">
          <Spans spans={row.gutter} />
        </span>
      )}
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
        <Spans spans={row.spans} />
      </span>
    </div>
  )
})

/* ---------------------------------------------------------------------------
 * Header: KnightHeader from extensions/ui/index.ts, inside the header
 * container's spacers.
 * ------------------------------------------------------------------------- */
const CWD = "~/dev/knightcode"
const HINT_SEPARATOR = s(" · ", C.muted)
const HINTS: Span[][] = [
  [
    ...hint("escape", "interrupt"),
    HINT_SEPARATOR,
    ...hint("ctrl+c/ctrl+d", "clear/exit"),
  ],
  [...hint("/", "commands"), HINT_SEPARATOR, ...hint("!", "bash")],
]
const spanWidth = (spans: Span[]) =>
  spans.reduce((n, span) => n + span.t.length, 0)

/** The glint plays once, a second after the header appears, then holds. */
function useGlintTime(): number {
  const reduceMotion = useReducedMotion()
  const [time, setTime] = useState(0)
  useEffect(() => {
    if (reduceMotion) {
      setTime(GLINT_SWEEP_SECONDS)
      return
    }
    let frame = 0
    let start: number | undefined
    const tick = (now: number) => {
      start ??= now
      const t = Math.min((now - start) / 1000, GLINT_SWEEP_SECONDS)
      setTime(t)
      if (t < GLINT_SWEEP_SECONDS) frame = requestAnimationFrame(tick)
    }
    const timer = setTimeout(
      () => (frame = requestAnimationFrame(tick)),
      GLINT_DELAY_MS
    )
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
    }
  }, [reduceMotion])
  return time
}

/** Columns the panel holds: the terminal width the header lays itself out for. */
function useColumns(ref: React.RefObject<HTMLElement | null>): number {
  const [columns, setColumns] = useState(80)
  // Layout effect, so the first paint already uses the measured width.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const probe = document.createElement("span")
    probe.textContent = "0".repeat(100)
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre"
    el.appendChild(probe)
    const measure = () =>
      setColumns(Math.floor(el.clientWidth / (probe.offsetWidth / 100)))
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => {
      observer.disconnect()
      probe.remove()
    }
  }, [ref])
  return columns
}

/** A logo row in half-cell pixels: each full block becomes `▀` over a
 *  background, so its two halves take their own colours. */
function LogoRow({ row, time }: { row: number; time: number }) {
  return (
    <>
      {[...LOGO[row]!].map((ch, x) => {
        const top =
          ch === "█" || ch === "▀" ? shimmer(x, row * 2, time) : "transparent"
        const bottom =
          ch === "█" || ch === "▄"
            ? shimmer(x, row * 2 + 1, time)
            : "transparent"
        return (
          <span
            key={x}
            className="w-[1ch] shrink-0"
            style={{
              background: `linear-gradient(${top} 50%, ${bottom} 50%)`,
            }}
          />
        )
      })}
    </>
  )
}

function Banner({ version }: { version: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const columns = useColumns(ref)
  const time = useGlintTime()

  const title = (x: number, y: number): Span[] => [
    ...[..."KnightCode"].map((ch, i) => s(ch, shimmer(x + i, y, time), true)),
    s(` v${version}`, C.dim),
  ]
  const below: Span[][] = [[s(CWD, C.muted)], [], ...HINTS]
  const textWidth = Math.max(
    `KnightCode v${version}`.length,
    ...below.map(spanWidth)
  )
  const wide = 1 + LOGO_WIDTH + LOGO_GAP + textWidth <= columns
  const top = Math.floor((LOGO.length - below.length - 1) / 2)
  const text = wide
    ? [title(LOGO_WIDTH + LOGO_GAP, top * 2 + 0.5), ...below]
    : [title(0, (LOGO.length + 1) * 2), ...below]

  const line = (key: string, children?: React.ReactNode) => (
    <div key={key} className="flex h-[1.45em] overflow-hidden whitespace-pre">
      {children}
    </div>
  )
  return (
    <div ref={ref} className="relative">
      {line("s0")}
      {line("t0")}
      {LOGO.map((_, row) =>
        line(
          `l${row}`,
          <>
            <span> </span>
            <LogoRow row={row} time={time} />
            {wide && text[row - top] && (
              <span>
                {" ".repeat(LOGO_GAP)}
                <Spans spans={text[row - top]!} />
              </span>
            )}
          </>
        )
      )}
      {!wide && [
        line("gap"),
        ...text.map((spans, i) =>
          line(
            `x${i}`,
            <span>
              {" "}
              <Spans spans={spans} />
            </span>
          )
        ),
      ]}
      {line("t1")}
      {line("s1")}
    </div>
  )
}

/**
 * While the agent runs, CustomEditor draws the status into the top border
 * itself: `╭── <spinner> Pondering… ───╮`. The spinner and verb use the accent
 * softened 20% toward text in oklch, with a text-coloured glimmer, matching
 * WorkingStatusIndicator in status-indicator.ts.
 */
function WorkingStatus({ verb }: { verb: string }) {
  const reduceMotion = useReducedMotion()
  const frame = useSpinnerFrame()
  const chars = [...verb]
  const center = reduceMotion
    ? -10
    : (Math.floor(Date.now() / SPINNER_MS) % (chars.length + 20)) - 10
  const start = Math.min(chars.length, Math.max(0, center - 1))
  const end = Math.min(chars.length, Math.max(0, center + 2))
  return (
    <>
      {"── "}
      <span
        style={{ color: `color-mix(in oklch, ${C.accent} 80%, ${C.text})` }}
      >
        {`${SPINNER[frame % SPINNER.length]} `}
        {chars.slice(0, start).join("")}
        <span style={{ color: C.text }}>
          {chars.slice(start, end).join("")}
        </span>
        {`${chars.slice(end).join("")} `}
      </span>
    </>
  )
}

/** One edge of the editor frame: corner, a rule clipped by the panel, corner. */
function FrameRule({
  left,
  right,
  color,
  children,
}: {
  left: string
  right: string
  color: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex whitespace-pre select-none" style={{ color }}>
      <span aria-hidden>{left}</span>
      <span className="min-w-0 flex-1 overflow-hidden">
        {children}
        <span aria-hidden>{"─".repeat(400)}</span>
      </span>
      <span aria-hidden>{right}</span>
    </div>
  )
}

/**
 * A side edge of the editor frame: one `│` per text row, as tall as the editor. The glyphs are absolutely
 * positioned so the rail never sets the row height; a wrapped prompt grows the editor and reveals more of them.
 */
function Rail({ color }: { color: string }) {
  return (
    <span
      className="relative w-[1ch] shrink-0 overflow-hidden select-none"
      style={{ color }}
      aria-hidden
    >
      <span className="absolute inset-x-0 top-0 whitespace-pre">
        {"│\n".repeat(60)}
      </span>
    </span>
  )
}

/* ---------------------------------------------------------------------------
 * Transcript content
 * ------------------------------------------------------------------------- */

/** Tool call header: bold name, themed args in parens. formatToolCall(). */
function toolCall(
  name: string,
  args: Span[]
): { gutter: Span[]; spans: Span[] } {
  return {
    gutter: [s(`${BULLET} `, C.accent)],
    spans: [s(name, C.toolTitle, true), s("("), ...args, s(")")],
  }
}

/** Collapsed result summary plus the expand hint. formatToolSummary(). */
function summary(text: string, expandable = true): Span[] {
  return expandable
    ? [s(text, C.toolOutput), s(" (ctrl+o to expand)", C.muted)]
    : [s(text, C.toolOutput)]
}

const path = (p: string): Span => s(p, C.accent)

/** UserMessageComponent: the dim marker in the gutter, all on the message
 *  background, with no spacer rows of its own. */
const userMessage = (text: string): Partial<Row> => ({
  gutter: [s(USER_GUTTER, C.dim)],
  spans: [s(text, C.text)],
  bg: C.userMsgBg,
  margin: true,
})

/** BashExecutionComponent's spacer and echoed command. `!!` runs are left out
 *  of context and drawn dim. */
const bashCommand = (text: string): Array<Partial<Row>> => {
  const excluded = text.startsWith("!!")
  const marker = excluded ? "!!" : "!"
  const command = text.slice(marker.length).trim()
  return [
    {},
    {
      gutter: [s(USER_GUTTER, C.dim)],
      spans: [s(`${marker}${command}`, excluded ? C.dim : C.bashMode, true)],
    },
  ]
}

/** Its Loader row while the command runs: padded 1, spinner then message. */
const RUNNING: Span[] = [
  s(" "),
  { t: "", c: C.bashMode, spin: true },
  s(" Running... (escape to cancel)", C.muted),
]

/** Write's collapsed preview: the first 10 highlighted lines (tabs as three
 *  spaces), then the remainder count. renderers/write.ts. */
const kw = (t: string) => s(t, C.synKeyword)
const str = (t: string) => s(t, C.synString)
const fn = (t: string) => s(t, C.synFunction)
const WRITE_PREVIEW: Span[][] = [
  [
    kw("import"),
    s(" { describe, expect, it, vi } "),
    kw("from"),
    s(" "),
    str('"vitest"'),
    s(";"),
  ],
  [
    kw("import"),
    s(" { AgentSession, MAX_WAIT } "),
    kw("from"),
    s(" "),
    str('"./agent-session.ts"'),
    s(";"),
  ],
  blank(),
  [s("describe("), str('"retry backoff"'), s(", "), fn("() =>"), s(" {")],
  [
    s("   it("),
    str('"never waits longer than MAX_WAIT"'),
    s(", "),
    kw("async"),
    s(" () => {"),
  ],
  [
    s("      "),
    kw("const"),
    s(" sleep = vi.fn("),
    kw("async"),
    s(" () => {});"),
  ],
  [
    s("      "),
    kw("const"),
    s(" session = "),
    kw("new"),
    s(" AgentSession({ sleep });"),
  ],
  [
    s("      "),
    kw("await"),
    s(" session.retry("),
    s("12", C.synNumber),
    s(");"),
  ],
  [
    s("      expect("),
    s("Math", C.synType),
    s(".max(...sleep.mock.calls.map("),
    fn("("),
    s("[ms]", C.synVariable),
    fn(") =>"),
    s(" ms))).toBe(MAX_WAIT);"),
  ],
  [s("   });")],
  [
    s("... (24 more lines, 34 total,", C.muted),
    s(" "),
    ...hint("ctrl+o", "to expand"),
    s(")", C.muted),
  ],
]

/* ---------------------------------------------------------------------------
 * The panel
 * ------------------------------------------------------------------------- */

/**
 * macOS window controls. Fills are the system's Big Sur-and-later traffic
 * lights; the glyph tints and glyph geometry are sampled from the real
 * buttons, so the paths are given in Apple's own 85.4-unit box. Note the zoom
 * glyph: two rounded triangles pointing out along the diagonal, not the "+"
 * that older mockups still draw - the plus is the option-click behaviour.
 */
const TRAFFIC_LIGHTS: ReadonlyArray<{
  label: string
  fill: string
  glyph: string
  d: string
}> = [
  {
    label: "Close",
    fill: "#ff5f57",
    glyph: "#460804",
    d: "M22.5 57.8 57.8 22.5c1.4-1.4 3.6-1.4 5 0l.1.1c1.4 1.4 1.4 3.6 0 5L27.6 62.9c-1.4 1.4-3.6 1.4-5 0l-.1-.1c-1.3-1.4-1.3-3.6 0-5ZM27.6 22.5 62.9 57.8c1.4 1.4 1.4 3.6 0 5l-.1.1c-1.4 1.4-3.6 1.4-5 0L22.5 27.6c-1.4-1.4-1.4-3.6 0-5l.1-.1c1.4-1.3 3.6-1.3 5 0Z",
  },
  {
    label: "Minimize",
    fill: "#febc2e",
    glyph: "#90591d",
    d: "M17.8 39.1h49.9c1.9 0 3.5 1.6 3.5 3.5v.1c0 1.9-1.6 3.5-3.5 3.5H17.8c-1.9 0-3.5-1.6-3.5-3.5v-.1c0-1.9 1.5-3.5 3.5-3.5Z",
  },
  {
    label: "Zoom",
    fill: "#28c840",
    glyph: "#2a6218",
    d: "M31.2 20.8h26.7c3.6 0 6.5 2.9 6.5 6.5V54L31.2 20.8ZM54.4 64.5H27.6c-3.6 0-6.5-2.9-6.5-6.5V31.2l33.3 33.3Z",
  },
]

/** Footer numbers before and after the scripted turn. */
const BEFORE_TURN = {
  context: "0%/200k",
  cost: "$0.000",
  speed: "— tok/s",
  files: 0,
}
const AFTER_TURN = {
  context: "8%/200k",
  cost: "$0.041",
  speed: "62 tok/s",
  files: 2,
}

class Cancelled extends Error {}

export function LiveTerminal({
  version = "0.0.0",
  className,
}: {
  version?: string
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const [rows, setRows] = useState<Row[]>([])
  const [input, setInput] = useState("")
  const [cursor, setCursor] = useState(0)
  // The verb the working status shows, or null while idle.
  const [working, setWorking] = useState<string | null>(null)
  const [stats, setStats] = useState(BEFORE_TURN)
  const [menuDismissed, setMenuDismissed] = useState(false)
  // Selection is stored with the token it belongs to, so a changed query resets
  // the highlight without an effect.
  const [menuPick, setMenuPick] = useState({ token: "", index: 0 })

  const idRef = useRef(0)
  const runRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const columnCount = useColumns(editorRef)
  const fieldRef = useRef<HTMLInputElement>(null)
  const stickRef = useRef(true)
  // Read inside the script instead of depended on: useReducedMotion settles from
  // null to a boolean after mount, and a dependency would replay the session.
  const reduceRef = useRef(false)

  const bashMode = input.trimStart().startsWith("!")
  const borderColor = bashMode ? C.bashMode : C.border

  /* -------------------------------------------------- row helpers */
  // Ids are allocated outside the updater: React may replay updaters, and the
  // caller needs the id back synchronously to patch the row later.
  const push = useCallback((...items: Array<Partial<Row>>) => {
    const next = items.map((item) => ({
      id: ++idRef.current,
      spans: item.spans ?? blank(),
      gutter: item.gutter,
      bg: item.bg,
      margin: item.margin,
      banner: item.banner,
    }))
    setRows((prev) => [...prev, ...next])
    return next[next.length - 1]!.id
  }, [])

  const patch = useCallback((id: number, next: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)))
  }, [])

  useEffect(() => {
    reduceRef.current = !!reduceMotion
  }, [reduceMotion])

  /* -------------------------------------------------- script runner */
  useEffect(() => {
    const run = ++runRef.current
    let unmounted = false
    const live = () => {
      if (unmounted || runRef.current !== run) throw new Cancelled()
    }
    const wait = (ms: number) =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, reduceRef.current ? 0 : ms)
      ).then(live)

    const type = async (text: string, cps = 42) => {
      if (reduceRef.current) {
        setInput((v) => v + text)
        setCursor((c) => c + text.length)
        await wait(0)
        return
      }
      for (const ch of text) {
        setInput((v) => v + ch)
        setCursor((c) => c + 1)
        await wait(cps + Math.random() * 45)
      }
    }

    const clearInput = () => {
      setInput("")
      setCursor(0)
    }

    /** Tool call, a beat of latency, then its result rows. `preview` hangs
     *  under the call itself, as Write's file preview does. */
    const tool = async (
      call: { gutter: Span[]; spans: Span[] },
      latency: number,
      result: Span[][],
      preview: Span[][] = []
    ) => {
      const id = push({}, call)
      if (preview.length)
        push({}, ...preview.map((spans) => ({ gutter: INDENT, spans })))
      await wait(latency)
      patch(id, { gutter: [s(`${BULLET} `, C.success)] })
      result.forEach((line, i) =>
        push({
          gutter: [s(i === 0 ? RESULT_GUTTER : RESULT_INDENT, C.dim)],
          spans: line,
        })
      )
      await wait(180)
    }

    /** Assistant prose, streamed a word at a time, under the block indent. */
    const say = async (text: string, color = C.text) => {
      const id = push({}, { gutter: INDENT, spans: blank(), margin: true })
      if (reduceRef.current) {
        patch(id, { spans: [s(text, color)] })
        await wait(0)
        return
      }
      let acc = ""
      for (const word of text.split(" ")) {
        acc = acc ? `${acc} ${word}` : word
        patch(id, { spans: [s(acc, color)] })
        await wait(38)
      }
    }

    const script = async () => {
      await wait(0)
      setRows([]) // a replay (StrictMode remount) starts from an empty session
      await wait(400)

      /* ---- session banner: the gradient knight beside title, folder, keys ---- */
      push({ banner: { version } })
      await wait(1600)

      /* ---- beat 1: an @ mention, picked from the menu rather than typed ---- */
      const prompt = `cap the agent retry backoff in @${MENTION}`
      await type("cap the agent retry backoff in @")
      await wait(900)
      await type(MENTION_QUERY, 110) // the list narrows as the token grows
      await wait(800)
      for (let index = 1; index <= MENTION_INDEX; index++) {
        setMenuPick({ token: `@${MENTION_QUERY}`, index }) // arrow down
        await wait(420)
      }
      await wait(500)
      // tab: the highlighted path drops in whole, with the trailing space
      setInput(`${prompt} `)
      setCursor(prompt.length + 1)
      await wait(900)

      /* ---- the turn ---- */
      clearInput()
      push(userMessage(prompt))
      setWorking(pickVerb())
      await wait(1000)

      await say(
        "I'll read the retry path first, then cap the backoff and cover it with a test."
      )
      await wait(300)

      await tool(
        toolCall("Read", [path("packages/cli/src/core/agent-session.ts")]),
        900,
        [summary("Read 2431 lines")]
      )

      await tool(
        toolCall("Search", [
          s("/retry|backoff/", C.accent),
          s(" in packages/cli/src", C.toolOutput),
          s(", *.ts", C.toolOutput),
        ]),
        700,
        [summary("Found 14 matches")]
      )

      await tool(
        toolCall("Glob", [
          s("**/*.test.ts", C.accent),
          s(" in packages/cli", C.toolOutput),
        ]),
        600,
        [summary("Found 37 files")]
      )

      await tool(
        toolCall("List", [
          path("packages/cli/src/core"),
          s(", limit 50", C.toolOutput),
        ]),
        550,
        [summary("Listed 41 paths")]
      )

      await tool(
        toolCall("Update", [path("packages/cli/src/core/agent-session.ts")]),
        1200,
        [
          summary(
            "Updated packages/cli/src/core/agent-session.ts with 3 additions and 1 removal",
            false
          ),
          ...[
            "      ...",
            " 1455    async retryAfterError(attempt: number): Promise<boolean> {",
            " 1456       const base = this.settings.retryBaseMs;",
            " 1457       if (attempt >= this.settings.maxRetries) return false;",
            " 1458       const delay = base * 2 ** attempt;",
          ].map((line) => [s(line, C.diffContext)]),
          [s("-1459       await sleep(delay);", C.diffRemoved)],
          [
            s(
              "+1459       // cap it: an outage must not stall us",
              C.diffAdded
            ),
          ],
          [
            s(
              "+1460       await sleep(Math.min(delay, MAX_WAIT));",
              C.diffAdded
            ),
          ],
          [s('+1461       this.emit("retry", attempt);', C.diffAdded)],
          ...[
            " 1460       return true;",
            " 1461    }",
            " 1462 ",
            " 1463    get retryCount(): number {",
            "      ...",
          ].map((line) => [s(line, C.diffContext)]),
        ]
      )

      await tool(
        toolCall("Write", [path("packages/cli/src/core/retry-cap.test.ts")]),
        800,
        [
          summary(
            "Wrote 34 lines to packages/cli/src/core/retry-cap.test.ts",
            false
          ),
        ],
        WRITE_PREVIEW
      )

      await tool(
        toolCall("Bash", [
          s("bun test packages/cli/src/core/retry-cap.test.ts", C.toolOutput),
        ]),
        1500,
        [
          [s("3 pass", C.toolOutput)],
          [s("0 fail", C.toolOutput)],
          [s("Ran 3 tests across 1 file.", C.toolOutput)],
          [s("Took 1.2s", C.muted)],
        ]
      )

      await say(
        "Backoff is capped at 30s and the retry now emits its attempt. Tests pass."
      )
      push(
        {},
        {
          gutter: INDENT,
          margin: true,
          spans: [
            s("- ", C.mdListBullet),
            s("agent-session.ts", C.mdCode),
            s(" — clamp the delay, emit ", C.text),
            s("retry", C.mdCode),
          ],
        }
      )
      push({
        gutter: INDENT,
        margin: true,
        spans: [
          s("- ", C.mdListBullet),
          s("retry-cap.test.ts", C.mdCode),
          s(" — covers the cap and the event", C.text),
        ],
      })
      setWorking(null)
      setStats(AFTER_TURN)
      await wait(1200)

      /* ---- beat 2: bash mode ---- */
      await type("!bun run check")
      await wait(900)
      clearInput()
      push(...bashCommand("!bun run check"), {
        gutter: [s(RESULT_GUTTER, C.dim)],
        spans: [s("$ tsc --noEmit", C.muted)],
      })
      const loader = push({ gutter: [s(RESULT_INDENT, C.dim)], spans: RUNNING })
      await wait(1400)
      patch(loader, { spans: [s("No type errors.", C.muted)] })
    }

    script().catch((error) => {
      if (!(error instanceof Cancelled)) throw error
    })

    return () => {
      unmounted = true
    }
    // Runs once per mount. Motion preference and version are read from refs so
    // they cannot restart a session that is already playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* -------------------------------------------------- autoscroll */
  // Follow the tail, but never yank a reader who scrolled up to the logo.
  // Stickiness is decided when the user scrolls, not when rows arrive: a single
  // append can be taller than any sane threshold (a wrapped diff), which would
  // otherwise look like the reader had scrolled away.
  const onTranscriptScroll = () => {
    const el = scrollRef.current
    if (el)
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [rows])

  /* -------------------------------------------------- autocomplete */
  const menu = useMemo(() => {
    if (menuDismissed) return null
    const before = input.slice(0, cursor)

    if (before.startsWith("/") && !before.includes(" ")) {
      const query = before.slice(1)
      const items = SLASH_COMMANDS.filter((c) =>
        subsequence(c.name, query)
      ).map((c) => ({
        value: c.name,
        label: c.name,
        description: c.description,
      }))
      return items.length
        ? { kind: "slash" as const, items, token: before }
        : null
    }

    const at = before.lastIndexOf("@")
    if (at !== -1 && !/[\s]/.test(before.slice(at + 1))) {
      const query = before.slice(at + 1).toLowerCase()
      // Fuzzy `@` search labels each match by its name, with the path beside it.
      const items = FILES.filter((p) => p.toLowerCase().includes(query)).map(
        (p) => ({
          value: p,
          label: p.slice(p.lastIndexOf("/") + 1),
          description: p as string | undefined,
        })
      )
      return items.length
        ? { kind: "file" as const, items, token: before.slice(at) }
        : null
    }

    return null
  }, [input, cursor, menuDismissed])

  const selected =
    menu && menuPick.token === menu.token
      ? Math.min(menuPick.index, menu.items.length - 1)
      : 0

  // SelectList sizes the primary column from the widest label plus a two-cell
  // gap, clamped to the editor's [12, 32].
  const primaryColumnWidth = menu
    ? Math.min(
        32,
        Math.max(12, ...menu.items.map((item) => item.label.length + 2))
      )
    : 0

  // SelectList keeps the selection centred in the visible window.
  const windowStart = menu
    ? Math.max(
        0,
        Math.min(
          selected - Math.floor(AUTOCOMPLETE_MAX_VISIBLE / 2),
          menu.items.length - AUTOCOMPLETE_MAX_VISIBLE
        )
      )
    : 0

  /* -------------------------------------------------- input */
  const takeOver = () => {
    if (runRef.current) runRef.current++
    setWorking(null)
  }

  const applyCompletion = () => {
    if (!menu) return
    const item = menu.items[selected]
    if (!item) return
    const head = input.slice(0, cursor - menu.token.length)
    const tail = input.slice(cursor)
    const inserted =
      menu.kind === "slash" ? `/${item.value} ` : `@${item.value} `
    const next = head + inserted + tail
    setInput(next)
    setCursor(head.length + inserted.length)
  }

  const submit = () => {
    const text = input.trim()
    if (!text) return
    setInput("")
    setCursor(0)

    if (text.startsWith("!")) {
      push(...bashCommand(text), {
        gutter: [s(RESULT_GUTTER, C.dim)],
        spans: [s("Demo shell: nothing actually ran.", C.muted)],
      })
      return
    }

    // Built-in commands open UI the demo does not have; say so the way
    // showStatus() does. An unknown `/word` is an ordinary prompt, as in the TUI.
    const name = text.startsWith("/") ? text.slice(1).split(" ")[0] : undefined
    if (SLASH_COMMANDS.some((c) => c.name === name)) {
      push(
        {},
        {
          gutter: PAD,
          spans: [
            s(`/${name} needs the real thing: install KnightCode.`, C.dim),
          ],
        }
      )
      return
    }

    push(userMessage(text))
    void runReply(text)
  }

  /** A short canned turn for anything the visitor types. */
  const runReply = async (prompt: string) => {
    const run = ++runRef.current
    const live = () => runRef.current === run
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    setWorking(pickVerb())
    await sleep(700)
    if (!live()) return

    push(
      {},
      {
        gutter: INDENT,
        margin: true,
        spans: [
          s(
            `Looking at "${truncate(prompt, 48)}" — reading the repo first.`,
            C.text
          ),
        ],
      }
    )
    await sleep(500)
    if (!live()) return

    const callId = push(
      {},
      toolCall("Search", [
        s(`/${truncate(prompt.split(" ")[0] ?? "", 18)}/`, C.accent),
        s(" in .", C.toolOutput),
      ])
    )
    await sleep(900)
    if (!live()) return
    patch(callId, { gutter: [s(`${BULLET} `, C.success)] })
    push(
      { gutter: [s(RESULT_GUTTER, C.dim)], spans: summary("Found 6 matches") },
      {},
      {
        gutter: INDENT,
        margin: true,
        spans: [
          s(
            "This panel is a demo of the TUI — install it to run the real thing.",
            C.text
          ),
        ],
      }
    )
    setWorking(null)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    takeOver()

    if (menu) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setMenuPick({
          token: menu.token,
          index: Math.min(selected + 1, menu.items.length - 1),
        })
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setMenuPick({ token: menu.token, index: Math.max(selected - 1, 0) })
        return
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault()
        applyCompletion()
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMenuDismissed(true)
        return
      }
    }

    if (event.key === "Enter") {
      event.preventDefault()
      submit()
      return
    }

    // Everything else is the native input's job; sync the caret after it moves.
    requestAnimationFrame(() => {
      const el = fieldRef.current
      if (el) setCursor(el.selectionStart ?? el.value.length)
    })
  }

  /* -------------------------------------------------- editor line */
  const before = input.slice(0, cursor)
  const at = input.slice(cursor, cursor + 1)
  const after = input.slice(cursor + 1)
  // Bash mode only recolours the frame; the text stays plain.
  const editorSpans: Span[] = [
    s(before),
    { t: at || " ", inverse: true },
    s(after),
  ]

  const footer = [
    columns(
      [s(CWD, C.text)],
      [s("openrouter/anthropic/claude-opus-5 · medium", C.muted)],
      columnCount
    ),
    columns(
      [s(`${stats.context} · ${stats.cost} · ${stats.speed}`, C.muted)],
      [
        s(
          `main · ${stats.files} ${stats.files === 1 ? "file" : "files"} changed · PR #252`,
          C.muted
        ),
      ],
      columnCount
    ),
  ]

  return (
    <div
      className={cn(
        // Glass, in both site themes. The panel keeps the TUI's dark palette -
        // the terminal owns its colours - so translucency has to come without
        // lifting the panel's luminance, or the dim footer row washes out.
        // backdrop-brightness darkens what is behind *before* compositing:
        // in light mode the shader stays visible as shape and warmth through
        // the glass while the surface reads as dark as ever. Dark mode is
        // already dark behind, so it just goes thinner.
        "flex flex-col overflow-hidden rounded-2xl",
        "border border-white/12 bg-[rgba(22,19,15,0.8)] dark:bg-[rgba(22,19,15,0.55)]",
        "backdrop-blur-lg backdrop-brightness-[0.35] backdrop-saturate-150 dark:backdrop-brightness-100",
        "shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55),inset_0_1px_0_0_rgba(255,255,255,0.08)]",
        className
      )}
    >
      {/* Window chrome. Not part of the TUI - it frames it, the way a terminal does. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/8 bg-white/[0.03] px-3.5 py-2.5">
        {/*
          12pt dots on 8pt gaps, the way the system spaces them. The glyphs are
          hidden until the pointer is over the group - also the system's
          behaviour - which is why the reveal lives on the wrapper and not on
          each dot: the flex gaps belong to the wrapper's box, so sweeping
          across the row never drops the hover. Pointers that cannot hover get
          them outright rather than never.
        */}
        <span className="group/lights flex gap-2" aria-hidden>
          {TRAFFIC_LIGHTS.map(({ label, fill, glyph, d }) => (
            <span
              key={label}
              className="size-3 rounded-full shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.18)]"
              style={{ backgroundColor: fill }}
            >
              <svg
                viewBox="0 0 85.4 85.4"
                className={cn(
                  "size-full opacity-0 transition-opacity duration-150 ease-out",
                  "group-hover/lights:opacity-100 pointer-coarse:opacity-100"
                )}
              >
                <path d={d} fill={glyph} />
              </svg>
            </span>
          ))}
        </span>
        <span
          className="ml-1 truncate font-mono text-[11px]"
          style={{ color: C.dim }}
        >
          knightcode — ~/dev/knightcode
        </span>
      </div>

      <div
        role="group"
        aria-label="Interactive KnightCode terminal demo"
        onClick={() => fieldRef.current?.focus()}
        className="flex min-h-0 flex-1 cursor-text flex-col px-2 pt-1 font-mono text-[11px] leading-[1.45] sm:text-[12px]"
      >
        {/* Transcript */}
        <div
          ref={scrollRef}
          onScroll={onTranscriptScroll}
          className="scrollbar-hairline min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          {rows.map((row) => (
            <RowView key={row.id} row={row} />
          ))}
        </div>

        {/* Editor, under the empty widget area's spacer row */}
        <div ref={editorRef} className="shrink-0">
          <div className="h-[1.45em]" />
          <FrameRule left="╭" right="╮" color={borderColor}>
            {working && <WorkingStatus verb={working} />}
          </FrameRule>

          <div className="flex">
            <Rail color={borderColor} />
            <div className="min-w-0 flex-1 px-[1ch] break-words whitespace-pre-wrap">
              <Spans spans={editorSpans} />
            </div>
            <Rail color={borderColor} />
          </div>

          <FrameRule left="╰" right="╯" color={borderColor} />

          {/* Autocomplete, drawn under the editor exactly like SelectList */}
          {menu && (
            <div className="pl-[2ch]">
              {menu.items
                .slice(windowStart, windowStart + AUTOCOMPLETE_MAX_VISIBLE)
                .map((item, i) => {
                  const isSelected = windowStart + i === selected
                  const label = item.label.padEnd(primaryColumnWidth, " ")
                  return (
                    <div
                      key={item.value}
                      className="truncate whitespace-pre"
                      style={{ color: isSelected ? C.accent : C.text }}
                    >
                      {/* `→ `: the arrow drawn into one cell, as a terminal fits
                          it to the grid. The font's glyph is a fallback wider
                          than 1ch, which runs into the label. */}
                      <span className="inline-flex h-[1.45em] w-[2ch] items-center align-top">
                        {isSelected && (
                          <svg
                            viewBox="0 0 10 10"
                            className="h-[1ch] w-[1ch]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.3}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="M0.5 5h9M6 1.5l3.5 3.5-3.5 3.5" />
                          </svg>
                        )}
                      </span>
                      {label}
                      {item.description && (
                        <span
                          style={{ color: isSelected ? C.accent : C.muted }}
                        >
                          {item.description}
                        </span>
                      )}
                    </div>
                  )
                })}
              {menu.items.length > AUTOCOMPLETE_MAX_VISIBLE && (
                <div className="whitespace-pre" style={{ color: C.muted }}>
                  {`  (${selected + 1}/${menu.items.length})`}
                </div>
              )}
            </div>
          )}

          {/* Footer: folder | model, then context, cost, speed | git. */}
          <div className="pb-1.5">
            {footer.map((spans, i) => (
              <div key={i} className="overflow-hidden whitespace-pre">
                <Spans spans={spans} />
              </div>
            ))}
          </div>
        </div>

        {/* The real input: zero-size and transparent, but in flow, so focusing it
            never scroll-jumps. It owns text entry, IME and mobile keyboards. */}
        <input
          ref={fieldRef}
          value={input}
          aria-label="KnightCode terminal input"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          onChange={(event) => {
            takeOver()
            setMenuDismissed(false)
            setInput(event.target.value)
            setCursor(event.target.selectionStart ?? event.target.value.length)
          }}
          onKeyUp={(event) =>
            setCursor(event.currentTarget.selectionStart ?? input.length)
          }
          onClick={(event) =>
            setCursor(event.currentTarget.selectionStart ?? input.length)
          }
          onKeyDown={onKeyDown}
          className="size-0 border-0 bg-transparent p-0 opacity-0 outline-none"
        />
      </div>
    </div>
  )
}

/** fuzzyFilter(): does `query` appear in `text` in order? */
function subsequence(text: string, query: string): boolean {
  if (!query) return true
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

/** truncateToWidth() for one-cell text: a `...` ellipsis inside the limit. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text
  if (max <= 3) return ".".repeat(Math.max(0, max))
  return `${text.slice(0, max - 3)}...`
}

/** The ui extension's footer row: `left` and `right` on one row; when both
 *  don't fit, left keeps ~45% and both truncate. */
function columns(left: Span[], right: Span[], width: number): Span[] {
  const l = left.map((span) => span.t).join("")
  const r = right.map((span) => span.t).join("")
  const gap = width - l.length - r.length
  if (gap >= 1) return [...left, s(" ".repeat(gap)), ...right]
  const fittedLeft = fit(l, Math.max(1, Math.floor(width * 0.45)))
  const fittedRight = fit(r, Math.max(1, width - fittedLeft.length - 1))
  return [
    s(fittedLeft, left[0]?.c),
    s(" ".repeat(Math.max(1, width - fittedLeft.length - fittedRight.length))),
    s(fittedRight, right[0]?.c),
  ]
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
