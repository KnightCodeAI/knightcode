# Claude-Code Parity Gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the 9 audited UI/UX gaps between knightcode and claude-code so the chat surface reaches claude-code-grade polish.

**Architecture:** Most gaps cluster in two components — the working/spinner row (`working-indicator.tsx`) and the permission dialog (`tool-permission-request.tsx`) — plus the code/diff renderers. We extract pure helpers (stall detection, token estimate, command-risk heuristic, line wrapping) so they're unit-testable, and keep the React wiring thin.

**Tech Stack:** Bun, React 19 + @opentui/react, bun:test. `useTerminalDimensions()` for width; live response length threaded from `session.tsx`.

---

## Shared plumbing (do first)

**Live response signal** — several tasks (4, 5, 7, 9) need the in-flight assistant output size + activity.

- `session.tsx` computes, for the streaming turn, `responseChars` = total chars across the last assistant message's `text` + `reasoning` parts, and `toolActive` = last part is an in-progress tool call (`state === "input-streaming" | "input-available"`).
- Thread `responseChars` and `toolActive` → `SessionShell` → `WorkingIndicator`.

---

### Task 1: Reject-with-feedback (gap #1)

**Files:**

- Modify: `components/messages/tool-permission-request.tsx`
- Modify: `hooks/use-chat.ts` (`confirmToolCall` signature + reject output)
- Modify: `components/messages/bot-message.tsx`, `screens/session.tsx` (thread the new param)

- [ ] **Step 1: Widen `confirmToolCall`** to `(toolCallId, allowed, always, feedback?: string)`. In the reject branch, set `errorText: feedback?.trim() ? \`User declined. Guidance: ${feedback.trim()}\` : "User rejected the changes"`. (Approve path ignores feedback for now.)
- [ ] **Step 2: Permission dialog feedback input.** In `ToolPermissionRequest`, when the focused option is the reject row, render an `<input>` below the options (placeholder `"tell Claude what to do differently…"`). Track a `feedback` state. On choosing reject (Enter on row 3, or Esc), pass the input value as `feedback`. Esc with empty input = plain cancel.
- [ ] **Step 3: Keyboard.** While the reject input is focused, Enter submits the rejection with feedback; ↑ returns focus to the option list. Keep 1/2 (yes/always) working from the list.
- [ ] **Step 4: Thread the param** through `bot-message.tsx` `onConfirm` and `session.tsx` `confirmToolCall` prop (already passed; just widen the type).
- [ ] **Step 5: Verify** types + that the reject error text reaches the model (unit-test the errorText builder if extracted).

_Out of scope:_ the "Yes, and tell Claude what to do next" approve-note (claude-code has it; lower value). Note it as a follow-up.

---

### Task 2: Code + diff line wrapping (gap #2)

**Files:**

- Create: `lib/ui/wrap-line.ts` + `wrap-line.test.ts`
- Modify: `components/messages/code-block.tsx`, `components/messages/diff-body.tsx`

- [ ] **Step 1 (TDD): `wrapText(text, width): string[]`** — hard-wrap to `width` columns, breaking long tokens, preserving leading indentation on continuation rows. Tests: short line → 1 row; long line → N rows; indent preserved.
- [ ] **Step 2: CodeBlock** — get `useTerminalDimensions()`, compute content width (term width − chrome/padding). Wrap each source line; tokenize+render each wrapped row. Continuation rows get no new content beyond their slice.
- [ ] **Step 3: DiffBody** — wrap the code portion to `width − gutterWidth`. Continuation rows render an empty gutter (spaces) so the green/red bar + alignment stay intact; the word-diff/syntax spans operate on each wrapped slice. (If full wrap+word-diff merge is too fiddly, wrap first, then syntax-highlight per slice and drop word-diff on wrapped lines.)
- [ ] **Step 4: Verify** visually (long lines) + unit tests for `wrapText`.

---

### Task 3: Streaming markdown mode (gap #3)

**Files:** `components/messages/markdown-view.tsx`, `bot-message.tsx`

- [ ] **Step 1:** Add `streaming?: boolean` to `MarkdownView`; pass it to native `<markdown streaming={streaming}>` (only the trailing prose block needs it, but passing to all is fine).
- [ ] **Step 2:** `BotMessage` already receives `streaming`; thread it to each `MarkdownView` for text parts (not reasoning). For the split blocks, only the **last** block is unstable, so pass `streaming` only to the final block; earlier blocks get `false`.
- [ ] **Step 3: Verify** a long streamed reply with a mid-stream table/code fence doesn't garble.

---

### Task 4: Spinner live token counter (gap #4)

**Files:** `lib/ui/format-duration.ts` (or new `format-tokens.ts`), `working-indicator.tsx`

- [ ] **Step 1 (TDD): `estimateTokens(chars): number`** and `formatTokenCount(n)` → `"1.2k"`/`"850"`. Tests for rounding/k-suffix.
- [ ] **Step 2:** `WorkingIndicator` receives `responseChars`; shows `↓ {formatTokenCount(estimateTokens(responseChars))} tokens` in the status tail (dim). Hidden until > ~0.
- [ ] **Step 3: Verify** the counter climbs during a reply.

---

### Task 5: Stall indicator — red spinner (gap #5)

**Files:** `lib/ui/stall.ts` + `stall.test.ts`, `working-indicator.tsx`

- [ ] **Step 1 (TDD): `useStall(responseChars, intervalMs)`** (or pure `isStalled(lastChange, now, 3000)`) — track last change time of `responseChars`; return `true` when no change for 3s.
- [ ] **Step 2:** When stalled (and not paused/awaiting input), color the glyph + verb `colors.error` (claude-code turns red). Resume normal color when tokens flow.
- [ ] **Step 3: Verify** the spinner reddens during a long quiet tool call, recovers when text streams.

---

### Task 6: Verb shimmer (gap #6)

**Files:** `working-indicator.tsx` (+ maybe `lib/ui/shimmer.ts`)

- [ ] **Step 1 (TDD): `shimmerIndex(elapsedMs, width, speed)`** — position of the bright character sweeping across the verb.
- [ ] **Step 2:** Render the verb as per-character `<span>`s; the char at `shimmerIndex` (and ±1) gets a brighter fg. Disable while stalled/paused.
- [ ] **Step 3: Verify** a subtle glimmer animates across the verb.

_Note:_ cosmetic; keep cheap (reuse the existing 120ms tick, don't add a second timer).

---

### Task 7: Tool-use spinner mode (gap #7)

**Files:** `working-indicator.tsx`

- [ ] **Step 1:** Receive `toolActive`. When a tool is executing, swap the glyph set / tint (claude-code flashes during tool use) — e.g., use `colors.autoMode` tint or a different frame cadence.
- [ ] **Step 2: Verify** the spinner visibly differs while a tool runs vs while text streams.

---

### Task 8: Bash permission risk hints (gap #8)

**Files:** `lib/permissions/command-risk.ts` + test, `components/messages/tool-permission-request.tsx` (`BashContent`)

- [ ] **Step 1 (TDD): `commandRisk(cmd): { level: "warn" | null; reason?: string }`** — heuristics: `rm -rf`, `sudo`, `curl|sh`/`wget|sh`, `> /dev/`, `chmod 777`, `:(){:|:&};:`, force-push, `dd`. Tests per pattern.
- [ ] **Step 2:** `BashContent` shows a dim/warning line above the command when `commandRisk` fires (e.g. `⚠ Deletes files recursively`).
- [ ] **Step 3: Verify** `rm -rf` shows a warning; `ls` shows none.

---

### Task 9: Spinner status order (gap #9)

**Files:** `working-indicator.tsx`

- [ ] **Step 1:** Reorder the dim tail to `(esc to interrupt · ↓N tokens · 12s)` to match claude-code (interrupt → tokens → elapsed). Compose from the pieces added in Tasks 4/1; omit absent pieces cleanly (no stray `·`).
- [ ] **Step 2: Verify** ordering + separators with/without tokens, with/without interruptible.

---

## Execution order

Shared plumbing → T3 (trivial) → T9/T4 (status tail) → T5 → T7 → T6 → T1 (biggest) → T2 (wrapping) → T8.

## Validation per task

`cd packages/cli && bun run check-types && bun test`. Visual items need the manual checklist (separate doc / message).
