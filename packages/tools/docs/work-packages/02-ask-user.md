# WP02 — `ask_user`: multiple-choice questions from the model

Status: implemented 2026-10-07; TUI picker checked by hand
Date: 2026-10-06

**Goal:** Give the model one tool, `ask_user`, that asks the user one to three
multiple-choice questions and waits for the answers. In the TUI it opens a
question picker. In RPC it uses the existing select and input dialogs. With no
user present it returns at once and tells the model to choose the recommended
options. Plan mode (a later work package) asks its questions with this tool.

**Architecture:** A new `ask_user` tool in `@knightcode/tools`: one folder
under `src/`, plus one line in `registry.ts`. It is off by default, so a
session that never enables it pays no tokens. Users turn it on with
`/tools ask_user on|always`, and plan mode will activate it for planning.
Outside the tool itself, the changes are two new select keybindings in
`packages/tui` and the activation rule in `state.ts` (section 5).

## 0. Mandatory reading

- `packages/tools/docs/work-packages/01-web-tools.md`: package layout, import
  rules (no runtime import of the `@knightcodeai/cli` barrel), registry.
- `packages/tools/src/registry.ts`, `state.ts` (`applyActiveTools`), `index.ts`.
- `packages/cli/examples/extensions/questionnaire.ts`: an existing
  `ctx.ui.custom` question picker. Reuse its rendering helpers
  (`wrapTextWithAnsi`, `visibleWidth`, wrapped-with-prefix lines). Do not copy
  its hardcoded `matchesKey` checks.
- `packages/cli/src/core/extensions/types.ts:114-231` (`ExtensionUIContext`,
  `ExtensionUIDialogOptions`), `:323-366` (`ExtensionContext`: `mode`, `hasUI`,
  `abort`), `:497-509` (`ToolExposure`), `:567-647` (`ToolDefinition`).
- `packages/cli/src/modes/rpc/rpc-mode.ts:132-145,225-228`: RPC supports
  `select` and `input`; `custom` resolves to `undefined`.
- `packages/cli/src/modes/interactive/components/extension-selector.ts`: the
  look of existing dialogs (`DynamicBorder`, accent title, `keyHint` footer).
- `packages/tui/src/keybindings.ts:37-43,145-160`: `tui.select.*` and
  `tui.input.tab`.

## 1. Problem

KnightCode has no way for the model to ask the user a structured question. The
only built-in dialogs are extension-side (`ctx.ui.select/confirm/input`), and
the one question tool in the repo is an example extension that:

- hardcodes keys (`matchesKey(data, Key.tab)`, `Key.escape`), which AGENTS.md
  forbids;
- refuses every mode except the TUI (`if (ctx.mode !== "tui") return
  errorResult(...)`), so RPC clients and headless runs get an error instead of
  a usable answer;
- has a verbose schema (`value`, `label`, `description`, `allowOther`, `label`
  per question) that costs tokens on every request while it is active;
- ignores the abort signal, so an interrupted turn leaves the picker open.

Plan mode needs a question tool that works in every mode and never blocks a
headless run.

## Decisions (fixed)

| Question | Decision | Rejected, and why |
|---|---|---|
| Name | `ask_user` | `questionnaire` (vague); `askuserquestion` for stealth-mode name mapping (unreadable; unmapped names already pass through unchanged, as MCP tools do) |
| Home | `packages/tools/src/ask/`, registry entry `defaultEnabled: false` | A core built-in in `packages/cli/src/core/tools` (adds to the token floor for every user) |
| Exposure | `model-only`, `executionMode: "sequential"` | `direct` (codemode scripts could open dialogs mid-script); parallel (two pickers at once) |
| Questions | 1-3 per call, 2-4 options each, `id` + `question` + `options[{label, description}]` | A per-question header chip and a multi-select flag (tokens with no consumer) |
| Free text | Always offered by the UI as a last "None of the above" row that opens a text field; the model never lists it | A model-controlled `allowOther` flag (one more field; the user should always be able to step outside the options) |
| Notes | Tab on a selected option opens a one-line note; the answer carries both | Notes only through "None of the above" (loses "yes, but...") |
| Esc / ctrl+c | With a note or text field open: close it. Otherwise: interrupt the turn, the same thing Esc does everywhere else in the TUI | Decline and continue (the model guesses anyway, which is exactly what the user just refused) |
| No user (`!ctx.hasUI`: print, JSON, engine) | Return immediately: "No user is available. Take the recommended option for each question and list it as an assumption." Not an error | An error result (models retry); blocking forever |
| RPC | Per question: `ctx.ui.select` with the labels plus "None of the above", which then opens `ctx.ui.input`; no notes | A new RPC message type (protocol change for one tool) |
| Result to the model | One plain line per question id (see Result format) | JSON (more tokens, no gain for the model) |
| Unanswered on submit | A two-row confirmation: "Submit" / "Go back" to the first unanswered question | Blocking submit until all are answered (the user may not care about one) |
| Question navigation keys | New `tui.select.left` / `tui.select.right` (defaults `left` / `right`) | Reusing `tui.editor.cursorLeft/Right` (wrong context); hardcoded arrows (forbidden) |
| Number keys 1-9 to pick | Not built | Needs nine bindings or a hardcoded digit check |

## 2. Tool contract

```ts
const askUserSchema = Type.Object({
	questions: Type.Array(
		Type.Object({
			id: Type.String({ description: "snake_case key for the answer" }),
			question: Type.String({ description: "One sentence" }),
			options: Type.Array(
				Type.Object({
					label: Type.String({ description: "1-5 words" }),
					description: Type.String({ description: "One sentence: the impact of choosing it" }),
				}),
				{ minItems: 2, maxItems: 4 },
			),
		}),
		{ minItems: 1, maxItems: 3 },
	),
});
```

Description, kept under 250 tokens together with the schema:

> Ask the user 1-3 multiple-choice questions and wait for the answers. Use it
> only for intent or trade-offs you cannot settle by reading the code. Put the
> recommended option first and end its label with "(Recommended)". Do not add
> an "Other" option; the user can always type their own answer.

No `promptSnippet`, no `promptGuidelines`: activating the tool changes only the
tool declarations, never the system-prompt sections.

`execute` validation, returned as an error result without opening any UI:
duplicate `id`s, an empty `question` or `label`.

### Result format

```
database: SQLite (Recommended)
auth: OAuth; note: keep API keys as a fallback
scope: Other: only the CLI package
style: unanswered
```

`details`:

```ts
interface AskUserDetails {
	questions: AskQuestion[];
	answers: Record<string, { label?: string; note?: string; other?: string }>;
	status: "answered" | "interrupted" | "no_user";
}
```

The status texts:

- `interrupted`: "The user interrupted the questions." The tool returns it
  with `terminate: true` and calls `ctx.abort()`, so the run stops after this
  batch. `ctx.abort()` does not await idle (`void this.abort()`), so calling
  it from inside the tool cannot deadlock. An executed result survives the
  abort (`agent-loop.ts:557-572`). `terminate` skips the aborted model call
  that would otherwise follow when `ask_user` is alone in its batch; the faux
  provider pops a scripted reply even for an aborted stream, so the suite test
  asserts that no reply was consumed.
- `no_user`: the assumption text from Decisions.

## 3. TUI picker (`src/ask/picker.ts`)

Opened with `ctx.ui.custom`, in the editor's place. Horizontal rules top and
bottom, like `ExtensionSelectorComponent`:

```
──────────────────────────────────────────────────────────
 Question 1/2 (2 unanswered)
 Which database should the cache use?

 → 1. SQLite (Recommended)
      One file, no server; already a dependency.
   2. Postgres
      Shared across machines; needs a running server.
   3. None of the above
      Type your own answer.

 tab add note · enter submit answer · left/right questions · escape interrupt
──────────────────────────────────────────────────────────
```

State per question: selected index, `committed` flag, note text, other text.

Behavior:

- `tui.select.up` / `tui.select.down` move the selection and clear `committed`.
- `tui.select.confirm` on an option commits it and moves to the next question.
  On the last question it submits. On "None of the above" it opens the text
  field instead.
- `tui.input.tab` on an option opens the note field below the list. Enter in
  the note commits option and note and moves on. Tab or Esc in the note clears
  it and returns to the options.
- `tui.select.left` / `tui.select.right` move between questions while the
  options have focus; the text fields keep those keys for the cursor.
- Text fields are the single-line `Input` component from `@knightcode/tui`,
  with a `›` prompt and a placeholder. Rejected: the editor the user types
  prompts into (the framed main input box), tried on 2026-10-07; it looked
  worse inside the picker.
- `tui.select.cancel` with a field open closes the field; otherwise it resolves
  `interrupted`.
- Submitting with unanswered questions shows the confirmation rows "Submit" /
  "Go back". Go back jumps to the first unanswered question.
- Footer hints show the first key of each binding through `formatKeyText`
  (deep import of `@knightcodeai/cli/modes/interactive/components/keybinding-hints`,
  never the cli barrel), read from the keybindings manager the picker is given,
  so remapped keys show their new names. On the "None of the above" row the
  Enter hint reads "type answer".
- Abort: `ctx.ui.custom` takes no signal. The component subscribes to the
  tool's `signal`, resolves `interrupted` on abort, and removes the listener in
  `dispose()`.
- Rendering is not cached; the picker is a few dozen lines.

## 4. Rendering in the transcript (`src/ask/render.ts`)

The transcript never shows the tool name. The call row is a heading,
"Questions", followed by "2 questions for you" while the picker is open and
"1/2 answered" afterwards:

```
● Questions 1/2 answered
  ⎿  • Which database should the cache use?
       answer: SQLite (Recommended)
       note: keep the file under .knightcode/
     • Which auth flow? (unanswered)
```

`renderCall` never sees the result, but the tool row calls `renderCall` then
`renderResult` on every update with one shared `context.state`. `renderCall`
stores its `Text` there, and `renderResult` records the outcome and rewrites
that header. The next `renderCall` reads the stored outcome, so later updates
keep it. Interrupted: header suffix "(interrupted)". No user: "not asked: no
user". A call that failed validation: "not asked".

## 5. Activation, and the interaction with plan mode

**Problem.** `applyActiveTools` ran on `session_start` and removed every
registry tool the user had not enabled. Registry tools activated on
registration, so the removal was what kept off-by-default tools off. It also
undid any other activation:

```
--tools read,ask_user        engine activates ask_user
session_start (tools ext.)   ask_user not enabled in tools.json -> removed
```

Plan mode activating `ask_user` would hit the same removal.

**Fix.** Registry tools register with `defaultActive: false` (`index.ts`), so
nothing activates them except `--tools`, `defaultTools`, a resumed session's
tool set, or another extension. `applyActiveTools` adds enabled tools and
removes only a tool whose persisted `enabled` is `false`, which is what
`/tools <name> off` writes. A tool that is merely off by default is left as it
is. Rejected: ordering plan mode after the tools extension (plan mode's
`tool_call` gate must run before the classifier gate, which the tools extension
registers), and keeping removal while exempting named tools (the extension
cannot see which names came from `--tools`).

**Plan mode, still to do there:**

- Plan mode activates `ask_user` in its planning loadout and names it in its
  instructions; it adds no question tool of its own.
- A user who ran `/tools ask_user off` still has it removed at
  `session_start`. Plan mode must re-activate it or refuse planning.
- User direction for plan mode (2026-10-06): read tools are allowed without
  prompting, and the only prompt is approving the submitted plan; no per-call
  shell confirmation.

## 6. Files

- `packages/tools/src/ask/tool.ts`: schema, description, `execute` (mode
  dispatch, validation, result formatting).
- `packages/tools/src/ask/picker.ts`: TUI component.
- `packages/tools/src/ask/render.ts`: `renderCall`, `renderResult`.
- `packages/tools/src/registry.ts`: `{ tool: askUserTool, defaultEnabled: false }`.
- `packages/tools/src/index.ts`, `state.ts`: the activation fix (section 5).
- `packages/tui/src/keybindings.ts`: `tui.select.left`, `tui.select.right`.
- Tests: `packages/tools/test/ask.test.ts`, `ask-picker.test.ts`, updated
  `extension.test.ts`, `state.test.ts`, `session.test.ts` (real engine:
  `--tools`, `defaultTools`, another extension, explicit off);
  `packages/cli/test/suite/ask-user.test.ts` (faux provider, full loop);
  `packages/tui/test/keybindings.test.ts`.
- Docs: `packages/cli/docs/usage.md` (Questions section), `keybindings.md`,
  `slash-commands.md`, `cli.md`, `settings.md`.
- Two changesets: `.changeset/ask-user-tool.md` (Added) and
  `ask-user-tool-2.md` (Changed: `--tools`/`defaultTools` names stay on).

## Required tests

- Validation: duplicate ids and empty labels return an error without touching
  `ctx.ui`; the schema rejects 0 or 4 questions and 1 or 5 options.
- No user (`hasUI: false`): returns the assumption text with
  `status: "no_user"` immediately, and the run continues.
- RPC path with a fake `ctx.ui`: picks a label; "None of the above" then input
  text; a cancelled select resolves `interrupted` and calls `ctx.abort()`.
- Result text: one line per id in question order, with note, other and
  unanswered forms exactly as in Result format.
- Picker, driven through `handleInput` with the default keybindings manager:
  - Enter commits and advances; Enter on the last question submits.
  - Tab opens a note, Enter commits option and note, and Esc in the note
    returns to the options with the note cleared.
  - "None of the above" opens the text field, and the answer is `other`.
  - Left/right move between questions only while the options have focus.
  - Submitting with an unanswered question shows the confirmation; "Go back"
    lands on it.
  - Esc with no field open resolves `interrupted`.
  - A remapped `tui.select.confirm` works and its hint shows the new key.
  - Aborting the signal resolves `interrupted`, and `dispose()` removes the
    listener.
- Render: the header for each outcome (asking, answered, interrupted, no user,
  failed), the body for answered, partial and typed answers, and the header
  switching to the outcome when the call and result renderers run in the tool
  row's order.
- Picker lines never exceed the width at 20 and 40 columns.
- Token budget: the JSON of the description plus schema is under 1,000
  characters (932 today, about 230 tokens).
- Registry: `ask_user` is registered, inactive by default, and
  `/tools ask_user on` activates it.

## Exclusions

Do not add:

- Auto-resolve timers or countdowns.
- A queue for concurrent requests; the tool is sequential.
- Multi-select questions, secret (password) questions, or a per-question
  header.
- Number-key shortcuts.
- An RPC protocol message, an ACP elicitation in the IDE engine, or remote
  (phone) UI. The engine and remote get the no-user path.
- Questions from subagents. They have no UI and get the no-user path.
- Any system-prompt section or guideline for the tool.
- Changes to `examples/extensions/questionnaire.ts` or `question.ts`.

## Validation

From the repo root:

- `bun run check-types`
- `cd packages/tools && bun x vitest --run test/ask.test.ts test/ask-picker.test.ts test/extension.test.ts`
- `cd packages/tui && node --test test/keybindings.test.ts`
- `bun x prettier --check "packages/tools/src/ask/*.ts" packages/tui/src/keybindings.ts`
- `bun run scripts/changelog-sections.ts`
- `rg -n "matchesKey|Key\." packages/tools/src/ask` → no matches.
- `rg -n "from \"@knightcodeai/cli\"" packages/tools/src/ask` → only
  `import type` lines.
- Manual: `bun run start`, `/tools ask_user on`, then prompt "Ask me two
  questions about how to name a file, using ask_user." Check navigation, a
  note, None of the above, the unanswered confirmation, Esc interrupt, and the
  transcript after `/resume`.
- Headless: `bun run start --tools read,ask_user -p "Use ask_user to ask me
  one question, then answer it yourself."` prints a reply that names the
  recommended option as an assumption.

## Stop condition

`ask_user` is complete when:

- It is registered, off by default, and toggled by `/tools`.
- The TUI picker supports options, notes, free text, question navigation,
  the unanswered confirmation and interrupt, using only configurable
  keybindings.
- RPC answers through `select` and `input`; print, JSON, the engine and
  subagents get the no-user result without blocking.
- An abort closes any open picker or dialog and releases the turn.
- The required tests pass, `bun run check-types` is clean, and the changeset
  validator passes.
