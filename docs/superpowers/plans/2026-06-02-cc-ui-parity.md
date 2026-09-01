# Claude-Code UI/UX Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port claude-code's exact chat/REPL look-and-feel onto KnightCode's OpenTUI stack — the `⏺`/`⎿` message structure, pulsing-asterisk spinner, effort glyphs, structured diff, footer, reasoning block, and select/dialog styling — so a KnightCode session is visually indistinguishable from claude-code (minus Anthropic branding/mascot).

**Architecture:** Build on the existing OpenTUI components from the `ui-revamp` work. Centralize claude-code's glyphs in one constants module, then restructure message rendering from the current left-border/status-glyph model to claude-code's **gutter model**: every assistant text block and tool call is prefixed with a `⏺` bullet (in the assistant accent color), and every tool _result_ renders as an indented dim `  ⎿  …` continuation row that collapses to a one-line summary with a `(ctrl+o to expand)` hint. Replace the spinner with claude-code's animated pulsing asterisk + status line. Pure formatting logic (glyph selection, tool-line/result formatting, effort/spinner mapping, diff summary) goes into TDD'd `lib/ui/` helpers; the visual components consume them. `useChat`, routing, providers, keyboard-layer, store, and inference are untouched.

**Tech Stack:** Bun 1.3.3 (Windows/PowerShell), `@opentui/react` + `@opentui/core`, `bun:test`, `@knightcode/shared`. Fidelity reference: the vendored `claude-code/src` (compiled but readable). Key references cited per task.

**Status going in (already done in `ui-revamp`):** input box (`❯` + top/bottom rules), user-message highlight bar, centered KnightCode logo + bottom-pinned input on Home, collapsible tool view, themed line-numbered diff, status bar on `status-format` helpers, Ctrl+O verbose toggle, per-spawn agent picker. This plan _upgrades_ those surfaces to exact claude-code fidelity.

---

## Workflow constraints (do not violate)

- **Never commit this plan, the spec, or the roadmap.** Commit **code only**, per finished phase. `docs/` stays untracked.
- **One commit for the whole phase**, squashed at the end (`git reset --soft <base>`), unless the branch is already published.
- **The user opens the PR**; never force-push a published branch — add a commit instead.
- **No AI name / `Co-Authored-By` trailer** in commits.
- Validate from INSIDE the package dir as ONE compound command (the `bun --cwd …` form misparses in Bun 1.3.3):
  - `cd "C:/Users/Raghav/Desktop/knightcode/packages/cli" && bun run check-types`
  - `cd "C:/Users/Raghav/Desktop/knightcode/packages/cli" && bun test`
- **OpenTUI rules:** `backgroundColor` is `<box>`-only (never `<text>`); inline color via `<em fg=…>`; theme colors via `useTheme().colors`; reuse existing theme keys (don't expand `ThemeColors` — that forces editing all ~33 themes). Highlights wrap `<text>` in a `<box backgroundColor>`. `ascii-font` reports ~0 width — center it via `alignItems` on a parent column, not `justifyContent`.

## Branch decision (resolve before Task 0)

These changes continue the UI revamp. Two options (the user picks):

- **Continue on `ui-revamp`** (it's unpushed) — fold this into the same phase commit. Simplest; one big UI PR.
- **New branch `cc-ui-parity`** off `ui-revamp` (or off `main` after `ui-revamp` merges) — a separate, independently reviewable PR.

The plan assumes a single base ref `BASE` (either `ui-revamp`'s parent `main`, or `ui-revamp` HEAD) chosen at Task 0.

## Glyph reference (from `claude-code/src/constants/figures.ts`)

| Glyph                      | Const                        | Use                                                                          |
| -------------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| `⏺` (darwin) / `●` (other) | `BLACK_CIRCLE`               | bullet before each assistant text block & tool call                          |
| `⎿`                        | —                            | result continuation (`"  ⎿  "`, dim) — see `MessageResponse.tsx:22`          |
| `○ ◐ ● ◉`                  | `EFFORT_LOW/MEDIUM/HIGH/MAX` | reasoning-effort indicator                                                   |
| `✻`                        | `TEARDROP_ASTERISK`          | thinking/welcome mark                                                        |
| `▎`                        | `BLOCKQUOTE_BAR`             | markdown blockquote prefix                                                   |
| `· ✢ ✳ ✶ ✻ ✽`              | spinner frames               | pulsing-asterisk working animation (`Spinner/utils.ts:getDefaultCharacters`) |

---

### Task 0: Branch + baseline

**Files:** none (git only).

- [ ] **Step 1:** Confirm the branch decision above. Be on the chosen branch with a clean tracked tree.
- [ ] **Step 2:** Baseline green:
      `cd "C:/Users/Raghav/Desktop/knightcode/packages/cli" && bun run check-types && bun test`
      Expected: types clean, all tests pass. If red, STOP and report.

---

### Task 1: Glyph constants (`lib/ui/figures.ts`, TDD)

Centralize the claude-code glyphs, platform-selecting the bullet exactly as claude-code does (`⏺` on darwin, `●` elsewhere — `●` is what Windows renders).

**Files:**

- Create: `packages/cli/src/lib/ui/figures.ts`
- Test: `packages/cli/src/lib/ui/figures.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/cli/src/lib/ui/figures.test.ts
import { describe, expect, test } from "bun:test";
import {
  bulletGlyph,
  EFFORT_GLYPH,
  RESULT_GUTTER,
  SPINNER_FRAMES,
} from "./figures";

describe("figures", () => {
  test("bullet is ⏺ on darwin, ● elsewhere", () => {
    expect(bulletGlyph("darwin")).toBe("⏺");
    expect(bulletGlyph("win32")).toBe("●");
    expect(bulletGlyph("linux")).toBe("●");
  });
  test("result gutter matches claude-code", () => {
    expect(RESULT_GUTTER).toBe("  ⎿  ");
  });
  test("effort glyphs", () => {
    expect(EFFORT_GLYPH.low).toBe("○");
    expect(EFFORT_GLYPH.medium).toBe("◐");
    expect(EFFORT_GLYPH.high).toBe("●");
    expect(EFFORT_GLYPH.max).toBe("◉");
  });
  test("spinner has the pulsing-asterisk frames", () => {
    expect(SPINNER_FRAMES).toEqual(["·", "✢", "✳", "✶", "✻", "✽"]);
  });
});
```

- [ ] **Step 2: Run; verify fail.** `… && bun test src/lib/ui/figures.test.ts` → FAIL.

- [ ] **Step 3: Implement.**

```ts
// packages/cli/src/lib/ui/figures.ts
/** Glyphs ported from claude-code/src/constants/figures.ts. */

/** Assistant/tool bullet: ⏺ aligns better on macOS; ● renders reliably elsewhere. */
export function bulletGlyph(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "darwin" ? "⏺" : "●";
}

export const BULLET = bulletGlyph();

/** Indented continuation marker before a tool result (dim). */
export const RESULT_GUTTER = "  ⎿  ";

/** Continuation indent for wrapped/multi-line result rows (aligns under ⎿ text). */
export const RESULT_INDENT = "     ";

export const EFFORT_GLYPH = {
  none: "",
  low: "○",
  medium: "◐",
  high: "●",
  max: "◉",
} as const;

export const THINKING_MARK = "✻";
export const BLOCKQUOTE_BAR = "▎";

/** Pulsing-asterisk spinner frames (claude-code Spinner/utils.ts). */
export const SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽"] as const;
```

- [ ] **Step 4: Run; verify pass.** Commit:
      `git add packages/cli/src/lib/ui/figures.ts packages/cli/src/lib/ui/figures.test.ts && git commit -m "feat(cli): claude-code glyph constants"`

---

### Task 2: Tool-line + result formatting helpers (`lib/ui/tool-line.ts`, TDD)

claude-code renders a tool call as `⏺ ToolName(primaryArg)` and its result as a short summary (`Read 42 lines`, `Updated src/x.ts with 3 additions and 1 removal`, etc.). Extend the existing `tool-presentation.ts` with claude-code-shaped formatters.

**Files:**

- Create: `packages/cli/src/lib/ui/tool-line.ts`
- Test: `packages/cli/src/lib/ui/tool-line.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/cli/src/lib/ui/tool-line.test.ts
import { describe, expect, test } from "bun:test";
import { toolCallLine, toolResultSummary } from "./tool-line";

describe("toolCallLine", () => {
  test("Name(primaryArg) form", () => {
    expect(toolCallLine("Read", { file_path: "src/a.ts" })).toBe(
      "Read(src/a.ts)",
    );
    expect(toolCallLine("Bash", { command: "ls -la" })).toBe("Bash(ls -la)");
    expect(toolCallLine("Grep", { pattern: "foo" })).toBe('Grep("foo")');
    expect(toolCallLine("Edit", { file_path: "src/a.ts" })).toBe(
      "Edit(src/a.ts)",
    );
  });
  test("truncates long args", () => {
    expect(
      toolCallLine("Bash", { command: "x".repeat(200) }).length,
    ).toBeLessThanOrEqual(72);
  });
});

describe("toolResultSummary", () => {
  test("string output → first-line + line count", () => {
    expect(toolResultSummary("Read", { file_path: "a" }, "l1\nl2\nl3")).toBe(
      "Read 3 lines",
    );
  });
  test("error → the error text", () => {
    expect(toolResultSummary("Bash", {}, undefined, "boom")).toBe("boom");
  });
  test("no output yet → empty", () => {
    expect(toolResultSummary("Read", {}, undefined)).toBe("");
  });
});
```

> NOTE: exact summary wording (`Read N lines`, `Updated … with N additions`) is finalized at implementation against claude-code's `messages/*Message.tsx`; keep the helper's branches small and tested. The Edit/Write "additions/removals" summary may reuse `lib/git/diff.ts`.

- [ ] **Step 2–4:** Run-fail → implement `toolCallLine`/`toolResultSummary` (reuse `summarizeToolInput` from `tool-presentation.ts` for the primary arg; wrap in `Name(...)`) → run-pass → commit
      `git commit -m "feat(cli): claude-code tool-line + result formatters"`.

---

### Task 3: Re-port `ToolCallView` to the `⏺`/`⎿` gutter model

Replace the left-`│`-border tool row with claude-code's structure: `⏺ Name(args)` on the call line, then a dim `  ⎿  {summary}` result row; collapsed by default with `(ctrl+o to expand)` when there's hidden detail; expands (per-row click or global Ctrl+O verbose) to the full output indented under the `⎿`.

**Files:**

- Rewrite: `packages/cli/src/components/messages/tool-call-view.tsx`

Fidelity refs: `claude-code/src/components/messages/AssistantToolUseMessage.tsx`, `MessageResponse.tsx` (the `"  ⎿  "` gutter), `components/CtrlOToExpand.tsx` (the hint).

- [ ] **Step 1:** Build the new layout:
  - Call line: `<text><em fg={accent}>{BULLET}</em> {toolCallLine(name, input)}</text>` where `accent` = the assistant/mode color (mode color from `usePromptConfig`, or a fixed assistant color — match claude-code's `text`/`secondary`).
  - Result line (when output/error present): a row with `<text dim>{RESULT_GUTTER}</text>` + `<text dim>{toolResultSummary(...)}</text>` and, when collapsed and there's more, append `(ctrl+o to expand)` dim.
  - Expanded (verbose `||` per-row): render full `detailLines` indented by `RESULT_INDENT`, capped (40 collapsed / 400 verbose), under the `⎿` row.
  - Keep `useVerbose()` + per-row `useState` toggle + `onMouseDown`.
- [ ] **Step 2:** check-types clean. Commit `refactor(cli): tool rows use ⏺/⎿ gutter model`.

---

### Task 4: Assistant bullet for text + reasoning blocks

In `bot-message.tsx`, prefix each assistant **text** block with the `⏺` bullet (in the accent color), matching claude-code where every assistant utterance starts with `⏺`. Restyle the **reasoning** block to claude-code's `✻ Thinking…` (dim italic, dim body, no heavy border).

**Files:**

- Modify: `packages/cli/src/components/messages/bot-message.tsx`

Fidelity refs: `messages/AssistantTextMessage.tsx`, `messages/AssistantThinkingMessage.tsx`.

- [ ] **Step 1:** Text branch → a row: `⏺` gutter + `<MarkdownText>` (the bullet sits at col 0, text indented). Keep `groupConsecutiveParts`.
- [ ] **Step 2:** Reasoning branch → `✻ Thinking…` header (dim, `colors.thinking`) + dim italic body; drop the `│` left border.
- [ ] **Step 3:** Remove the old per-message footer (`◉ Build › model › 1.2s`) OR slim it to claude-code's style (claude-code shows no per-message mode footer; timing/usage live elsewhere). Decision: drop it for fidelity, keep model/usage only in the status bar. Confirm nothing else depends on it.
- [ ] **Step 4:** check-types + tests green. Commit `refactor(cli): assistant ⏺ bullets + claude-code thinking block`.

---

### Task 5: Pulsing-asterisk spinner + working status

Replace the `opentui-spinner` dots with claude-code's animated pulse `· ✢ ✳ ✶ ✻ ✽` and the status line `{word}… (esc to interrupt)`. claude-code cycles a verb word ("Thinking", "Working", …) — keep one stable word for v1 (e.g. "Working") to avoid scope creep.

**Files:**

- Create: `packages/cli/src/lib/ui/use-spinner-frame.ts` (+ test for the frame-index math) — a hook/util returning the current frame from `SPINNER_FRAMES` on an interval.
- Modify: `packages/cli/src/components/spinner.tsx` to render the pulsing asterisk in `colors.primary` (mode-colored), driven by the util.
- Modify: `packages/cli/src/components/session-shell.tsx` footer working row → `{frame} Working… (esc to interrupt)`.

Fidelity refs: `claude-code/src/components/Spinner.tsx`, `Spinner/utils.ts`, `Spinner/SpinnerGlyph.tsx`.

- [ ] TDD the frame-index helper (`frameAt(ms, frameCount, intervalMs)`), then wire the component (interval via `useEffect`/`setInterval` + `useState`). check-types + tests. Commit `feat(cli): pulsing-asterisk spinner`.

---

### Task 6: Status bar / footer fidelity

Bring the status bar in line with claude-code's footer: effort as a glyph (`○◐●◉`), compact `model · mode · context%` separators, and the bottom hint row reading like claude-code (`? for shortcuts`-style, plus the existing `ctrl+o`). Consume `EFFORT_GLYPH`.

**Files:**

- Modify: `packages/cli/src/components/status-bar.tsx` (effort glyph via `EFFORT_GLYPH[reasoningEffort]`).
- Modify: `packages/cli/src/components/session-shell.tsx` (footer hint wording).

Fidelity refs: `claude-code/src/components/PromptInput/PromptInputFooter.tsx`, `PromptInputFooterLeftSide.tsx`.

- [ ] Implement, check-types + tests. Commit `refactor(cli): effort glyphs + footer fidelity`.

---

### Task 7: Structured diff fidelity

Align `DiffView` with claude-code's `StructuredDiff`: a header summary line `{verb} {file} with N addition(s) and M removal(s)`, line-number gutter, and `+`/`-` rows with subtle colored backgrounds (added = green bg, removed = red bg) rather than only colored foreground.

**Files:**

- Create: `packages/cli/src/lib/ui/diff-summary.ts` (+ test): `diffSummary(oldStr, newStr) → { additions, removals }` from `lib/git/diff.ts`.
- Modify: `packages/cli/src/components/messages/diff-view.tsx`.

Fidelity refs: `claude-code/src/components/StructuredDiff.tsx`.

> NOTE: OpenTUI line backgrounds need a `<box backgroundColor>` per row wrapping the `<text>` (bg is box-only). Use very dark green/red derived from `colors.success`/`colors.error` if available, else fall back to fg-only — finalize against the live render.

- [ ] TDD the summary helper, wire the component, check-types + tests. Commit `refactor(cli): claude-code structured diff`.

---

### Task 8: Select / dialog list fidelity

Match claude-code's select lists: a `❯` marker on the highlighted row (already partly done), tighter spacing, dim descriptions, and the dialog frame chrome. Apply to `DialogSearchList`, the command menu, the mention menu, and `AgentSpawnConfirm`/model pickers so every list shares one look.

**Files:**

- Modify: `packages/cli/src/components/dialog-search-list.tsx`, `components/command-menu/index.tsx`, `components/input-bar.tsx` (FileMentionMenu), `components/messages/agent-spawn-confirm.tsx`.

Fidelity refs: `claude-code/src/components/CustomSelect/*`, `components/ui/TreeSelect.tsx`.

- [ ] Unify the row renderer (`❯ ` marker in `colors.primary`, black-on-`colors.selection` when selected). check-types + tests. Commit `refactor(cli): unified claude-code select rows`.

---

### Task 9: Markdown fidelity pass

Bring `markdown-renderer.ts` output in line with claude-code: blockquote prefix `▎` (`BLOCKQUOTE_BAR`), heading colors, list bullets, and inline code styling. This is a polish pass over the existing renderer (tests already exist in `markdown-renderer.test.ts`).

**Files:**

- Modify: `packages/cli/src/lib/markdown/markdown-renderer.ts` (+ extend its test).

Fidelity refs: claude-code markdown rendering in `messages/HighlightedThinkingText.tsx` and the markdown util.

- [ ] Add/adjust with tests for any rule changed (blockquote bar, etc.). check-types + tests. Commit `refactor(cli): markdown fidelity (blockquote bar, headings)`.

---

### Task 10: Whole-phase review, manual smoke, squash/handoff

**Files:** none beyond review fixes.

- [ ] **Step 1:** Full validation: cli `check-types` + `test`, shared `test`. All green.
- [ ] **Step 2:** Manual smoke (throwaway `KNIGHTCODE_HOME` + real key): run a session that triggers Read/Bash/Edit/Agent and verify against claude-code side-by-side:
  - `⏺` bullets on every assistant block + tool call; `  ⎿  ` result rows; `(ctrl+o to expand)` hints; Ctrl+O expands all.
  - pulsing-asterisk spinner + `esc to interrupt`.
  - status bar effort glyph; diff summary + colored rows.
  - user bar, centered logo, bottom-pinned input.
  - no API key ever rendered.
- [ ] **Step 3:** Self-review the cumulative diff; no stray hardcoded colors in touched files; no `docs/` staged.
- [ ] **Step 4:** Squash to one commit (if unpublished) `git reset --soft BASE && git commit -m "feat(cli): claude-code chat UI parity (⏺/⎿ messages, pulse spinner, effort glyphs, structured diff)"`.
- [ ] **Step 5:** Re-validate; **do not push** — hand off the commit SHA + summary for the user to push/PR.

---

## Self-review (writing-plans checklist)

**Coverage of "exact claude-code UI/UX":** welcome/logo (done in ui-revamp), input box (done), user bar (done), Ctrl+O (done) → upgraded here: assistant `⏺` bullets (T4), tool `⏺/⎿` rows (T2,T3), thinking block (T4), pulse spinner (T5), effort glyphs + footer (T6), structured diff (T7), select/dialog rows (T8), markdown (T9). Glyph source-of-truth (T1). Gaps intentionally out of scope (note below).

**Out of scope (not relevant to KnightCode / deferred):** Anthropic mascot (Clawd) & "Welcome to Claude Code" banner (KnightCode keeps its own logo), billing/upsell surfaces, teammate/swarm UI, MCP dialogs, fullscreen/transcript _pager_ (Ctrl+O does inline expand, not a separate full-screen pager — call out for the user; a true pager is a much larger build), voice mode, IDE onboarding.

**Type/Name consistency:** `BULLET`/`RESULT_GUTTER`/`EFFORT_GLYPH`/`SPINNER_FRAMES` from `figures.ts` are the single source consumed by T3–T7; `toolCallLine`/`toolResultSummary` (T2) consumed by T3; `diffSummary` (T7) by `DiffView`.

**Placeholder scan:** visual exactness is finalized at implementation against the live render and claude-code source (flagged in NOTEs); every code step ships compiling code. Testable logic (glyphs, formatters, spinner frame math, diff summary) is TDD'd.

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-06-02-cc-ui-parity.md`. Decide the **branch** (continue `ui-revamp` vs new `cc-ui-parity`), then choose execution:

1. **Subagent-Driven (recommended)** — fresh subagent per task + two-stage review (as the `ui-revamp` phase ran).
2. **Inline** — execute here with checkpoints.
