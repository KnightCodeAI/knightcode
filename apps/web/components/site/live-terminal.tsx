"use client"

import {
  memo,
  useCallback,
  useEffect,
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
  pageBg: "#18181e",
  text: "#d4d4d4",
  muted: "#808080",
  dim: "#666666",
  accent: "#8abeb7",
  success: "#57ab5a",
  error: "#e5534b",
  warning: "#ffff00",
  border: "#5f87ff",
  borderMuted: "#505050",
  userMsgBg: "#343541",
  toolTitle: "#d4d4d4",
  toolOutput: "#808080",
  bashMode: "#57ab5a",
  customLabel: "#9575cd",
  customMsgBg: "#2d2838",
  customMsgText: "#d4d4d4",
  mdHeading: "#f0c674",
  mdCode: "#8abeb7",
  mdListBullet: "#8abeb7",
  diffAdded: "#57ab5a",
  diffRemoved: "#e5534b",
  diffContext: "#808080",
  thinkingMedium: "#81a2be",
  synComment: "#6A9955",
  synKeyword: "#569CD6",
  synFunction: "#DCDCAA",
  synString: "#CE9178",
  synNumber: "#B5CEA8",
  synType: "#4EC9B0",
} as const

/* Glyph vocabulary: packages/cli/src/modes/interactive/glyphs.ts (non-darwin set). */
const BULLET = "●"
const RESULT_GUTTER = "  ⎿  "
const RESULT_INDENT = "     "
const USER_GUTTER = "> "
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** The knight, verbatim from components/first-time-setup.ts. */
const SETUP_LOGO_LINES = [
  "      ▄███▄▄",
  "  ▄▄█████████▄▄",
  "▀███▀▀▀█████████",
  "    ▄███████████",
  "   ██████████▀▀",
  "  ███████████▄▄",
  "  ▀▀▀▀▀▀▀▀▀▀▀▀▀",
]

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
  { name: "quit", description: "Quit KnightCode" },
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
type Span = { t: string; c?: string; b?: boolean; inverse?: boolean }
type Row = {
  id: number
  gutter?: Span[]
  spans: Span[]
  bg?: string
  /** Clip instead of wrap — for full-bleed rules drawn as repeated `─`. */
  nowrap?: boolean
  /** Line-height 1, so block-drawing glyphs tile vertically as they do in a
   *  terminal cell grid. Without it the logo comes out striped. */
  tight?: boolean
  /** Session banner: the knight tiles on the left, the startup header sits
   *  beside it. Two independent stacks, so wrapped text can never pull the
   *  logo's rows apart. */
  banner?: { logo: string[]; lines: Span[][] }
}

const s = (t: string, c?: string, b?: boolean): Span => ({ t, c, b })
const blank = (): Span[] => [s("")]

/** keyHint(): the key dim, the description muted. Joined with a non-breaking
 *  space so a wrap lands between hints, never inside one. */
const hint = (key: string, description: string): Span[] => [
  s(key, C.dim),
  s(` ${description}`, C.muted),
]

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
            {span.t}
          </span>
        )
      })}
    </>
  )
}

const RowView = memo(function RowView({ row }: { row: Row }) {
  if (row.banner) {
    return (
      <div className="flex items-center gap-4 py-3 pl-1 sm:gap-5">
        {/* leading-none is what makes the block glyphs tile; it also squashes
            the art, because a terminal cell is ~2:1 and a 1em line box is
            ~1.65:1. scaleY stretches the tiled block back to cell proportions
            without reintroducing gaps between rows. */}
        <span
          className="shrink-0 leading-none whitespace-pre"
          style={{ color: C.accent, transform: "scaleY(1.22)" }}
        >
          {row.banner.logo.join("\n")}
        </span>
        <div className="min-w-0 flex-1">
          {row.banner.lines.map((spans, i) => (
            <div
              key={i}
              className="min-h-[1.45em] break-words whitespace-pre-wrap"
            >
              <Spans spans={spans} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex w-full",
        row.tight ? "leading-none" : "min-h-[1.45em]",
        row.nowrap && "overflow-hidden"
      )}
      style={row.bg ? { background: row.bg } : undefined}
    >
      {row.gutter && (
        <span className="shrink-0 whitespace-pre">
          <Spans spans={row.gutter} />
        </span>
      )}
      <span
        className={cn(
          "min-w-0 flex-1",
          row.nowrap ? "whitespace-pre" : "break-words whitespace-pre-wrap"
        )}
      >
        <Spans spans={row.spans} />
      </span>
    </div>
  )
})

/**
 * The editor's top border while the agent runs: CustomEditor draws the status
 * into the rule itself as `── <spinner> Working (escape to interrupt) ───`.
 */
function WorkingRule({
  color,
  static: frozen,
}: {
  color: string
  static: boolean
}) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (frozen) return
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), 80)
    return () => clearInterval(id)
  }, [frozen])
  return (
    <div
      className="overflow-hidden whitespace-pre select-none"
      style={{ color }}
    >
      {`── ${SPINNER[frame]} Working (escape to interrupt) ${"─".repeat(400)}`}
    </div>
  )
}

/** A full-bleed rule, clipped by the panel. `─`.repeat(width) in the TUI. */
function Rule({ color = C.borderMuted }: { color?: string }) {
  return (
    <div
      className="overflow-hidden whitespace-pre select-none"
      style={{ color }}
      aria-hidden
    >
      {"─".repeat(400)}
    </div>
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
  const [working, setWorking] = useState(false)
  const [menuDismissed, setMenuDismissed] = useState(false)
  // Selection is stored with the token it belongs to, so a changed query resets
  // the highlight without an effect.
  const [menuPick, setMenuPick] = useState({ token: "", index: 0 })

  const idRef = useRef(0)
  const runRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLInputElement>(null)
  const stickRef = useRef(true)
  // Read inside the script instead of depended on: useReducedMotion settles from
  // null to a boolean after mount, and a dependency would replay the session.
  const reduceRef = useRef(false)

  const bashMode = input.startsWith("!")
  const borderColor = bashMode ? C.bashMode : C.thinkingMedium

  /* -------------------------------------------------- row helpers */
  // Ids are allocated outside the updater: React may replay updaters, and the
  // caller needs the id back synchronously to patch the row later.
  const push = useCallback((...items: Array<Partial<Row>>) => {
    const next = items.map((item) => ({
      id: ++idRef.current,
      spans: item.spans ?? blank(),
      gutter: item.gutter,
      bg: item.bg,
      nowrap: item.nowrap,
      tight: item.tight,
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

    /** Tool call, a beat of latency, then its result rows. */
    const tool = async (
      call: { gutter: Span[]; spans: Span[] },
      latency: number,
      result: Span[][]
    ) => {
      const id = push({}, call)
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

    /** Assistant prose, streamed a word at a time. Padded 1, no gutter. */
    const say = async (text: string, color = C.text) => {
      const id = push({}, { spans: [s(" ")] })
      if (reduceRef.current) {
        patch(id, { spans: [s(` ${text}`, color)] })
        await wait(0)
        return
      }
      let acc = ""
      for (const word of text.split(" ")) {
        acc = acc ? `${acc} ${word}` : word
        patch(id, { spans: [s(` ${acc}`, color)] })
        await wait(38)
      }
    }

    const script = async () => {
      await wait(0)
      setRows([]) // a replay (StrictMode remount) starts from an empty session
      await wait(400)

      /* ---- session banner: the knight, with the startup header beside it ---- */
      push(
        { spans: [s("─".repeat(400), C.border)], nowrap: true },
        {
          banner: {
            logo: SETUP_LOGO_LINES,
            lines: [
              [s("KnightCode", C.accent, true), s(` v${version}`, C.dim)],
              [
                ...hint("escape", "interrupt"),
                s(" · ", C.muted),
                ...hint("ctrl+c/ctrl+d", "clear/exit"),
                s(" · ", C.muted),
                ...hint("/", "commands"),
                s(" · ", C.muted),
                ...hint("!", "bash"),
                s(" · ", C.muted),
                ...hint("ctrl+o", "more"),
              ],
              [
                s(
                  "Press ctrl+o to show full startup help and loaded resources.",
                  C.dim
                ),
              ],
              [],
              [
                s(
                  "KnightCode can explain its own features and look up its docs. Ask it how to use or extend KnightCode.",
                  C.dim
                ),
              ],
            ],
          },
        },
        { spans: [s("─".repeat(400), C.border)], nowrap: true },
        {}
      )
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
      push(
        { spans: blank(), bg: C.userMsgBg },
        { spans: [s(` ${prompt}`, C.text)], bg: C.userMsgBg },
        { spans: blank(), bg: C.userMsgBg }
      )
      setWorking(true)
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
          [s("1458   const delay = base * 2 ** attempt;", C.diffContext)],
          [s("-1459  await sleep(delay);", C.diffRemoved)],
          [s("+1459  // cap it: an outage must not stall us", C.diffAdded)],
          [s("+1460  await sleep(Math.min(delay, MAX_WAIT));", C.diffAdded)],
          [s('+1461  this.emit("retry", attempt);', C.diffAdded)],
          [s("1462   }", C.diffContext)],
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
        ]
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
          spans: [
            s(" • ", C.mdListBullet),
            s("agent-session.ts", C.mdCode),
            s(" — clamp the delay, emit ", C.text),
            s("retry", C.mdCode),
          ],
        }
      )
      push(
        {
          spans: [
            s(" • ", C.mdListBullet),
            s("retry-cap.test.ts", C.mdCode),
            s(" — covers the cap and the event", C.text),
          ],
        },
        {}
      )
      setWorking(false)
      await wait(1200)

      /* ---- beat 2: bash mode ---- */
      await type("!bun run check")
      await wait(900)
      clearInput()
      push(
        {},
        {
          gutter: [s(USER_GUTTER, C.dim)],
          spans: [s("!bun run check", C.bashMode, true)],
        },
        {
          gutter: [s(RESULT_GUTTER, C.dim)],
          spans: [s("$ tsc --noEmit", C.muted)],
        }
      )
      await wait(1400)
      push(
        {
          gutter: [s(RESULT_INDENT, C.dim)],
          spans: [s("No type errors.", C.muted)],
        },
        { gutter: [s(RESULT_INDENT, C.dim)], spans: [s("Took 4.1s", C.muted)] },
        {}
      )
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
      const items = FILES.filter((p) => p.toLowerCase().includes(query)).map(
        (p) => ({
          value: p,
          label: p,
          description: undefined as string | undefined,
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

  // SelectList sizes the primary column from the widest label, clamped
  // to [minPrimaryColumnWidth, maxPrimaryColumnWidth] plus a one-cell gap.
  const primaryColumnWidth =
    menu?.kind === "slash"
      ? Math.min(
          33,
          Math.max(13, ...menu.items.map((item) => item.label.length + 1))
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
    setWorking(false)
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
      const command = text.replace(/^!+/, "")
      push(
        {},
        { gutter: [s(USER_GUTTER, C.dim)], spans: [s(text, C.bashMode, true)] },
        {
          gutter: [s(RESULT_GUTTER, C.dim)],
          spans: [s(`$ ${command}`, C.muted)],
        },
        {
          gutter: [s(RESULT_INDENT, C.dim)],
          spans: [s("Demo shell: nothing actually ran.", C.muted)],
        },
        {}
      )
      return
    }

    if (text.startsWith("/")) {
      const name = text.slice(1).split(" ")[0]
      const command = SLASH_COMMANDS.find((c) => c.name === name)
      // Custom messages render in their own tinted block, like /session does.
      push(
        {},
        { spans: blank(), bg: C.customMsgBg },
        command
          ? {
              bg: C.customMsgBg,
              spans: [
                s(` [/${command.name}] `, C.customLabel, true),
                s(command.description, C.customMsgText),
              ],
            }
          : {
              bg: C.customMsgBg,
              spans: [s(` Unknown command: /${name}`, C.error)],
            },
        { spans: blank(), bg: C.customMsgBg },
        {}
      )
      return
    }

    push(
      { spans: blank(), bg: C.userMsgBg },
      { spans: [s(` ${text}`, C.text)], bg: C.userMsgBg },
      { spans: blank(), bg: C.userMsgBg }
    )
    void runReply(text)
  }

  /** A short canned turn for anything the visitor types. */
  const runReply = async (prompt: string) => {
    const run = ++runRef.current
    const live = () => runRef.current === run
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    setWorking(true)
    await sleep(700)
    if (!live()) return

    push(
      {},
      {
        spans: [
          s(
            ` Looking at "${truncate(prompt, 48)}" — reading the repo first.`,
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
        spans: [
          s(
            " This panel is a demo of the TUI — install it to run the real thing.",
            C.text
          ),
        ],
      },
      {}
    )
    setWorking(false)
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
  const inputColor = bashMode ? C.bashMode : C.text

  const editorSpans: Span[] = [
    s(before, inputColor, bashMode),
    { t: at || " ", inverse: true },
    s(after, inputColor, bashMode),
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
        "border border-white/12 bg-[rgba(24,24,30,0.8)] dark:bg-[rgba(24,24,30,0.55)]",
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

        {/* Editor */}
        <div className="shrink-0">
          {working ? (
            <WorkingRule color={borderColor} static={!!reduceMotion} />
          ) : (
            <Rule color={borderColor} />
          )}

          <div className="px-1 py-px">
            <div className="break-words whitespace-pre-wrap">
              <Spans spans={editorSpans} />
            </div>
          </div>

          <Rule color={borderColor} />

          {/* Autocomplete, drawn under the editor exactly like SelectList */}
          {menu && (
            <div className="px-1">
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
                      {isSelected ? "→ " : "  "}
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

          {/* Footer: cwd + branch, then usage with the model right-aligned. */}
          <div className="px-1 pt-0.5">
            <div className="truncate" style={{ color: C.dim }}>
              ~/dev/knightcode (main)
            </div>
            <div className="flex justify-between gap-4 pb-1.5">
              <span className="truncate" style={{ color: C.dim }}>
                ↑12.4k ↓3.1k R84.2k W12.0k CH92.4% $0.041 8.2%/200k (auto)
              </span>
              <span
                className="hidden shrink-0 sm:inline"
                style={{ color: C.dim }}
              >
                claude-opus-5 • medium
              </span>
            </div>
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

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
