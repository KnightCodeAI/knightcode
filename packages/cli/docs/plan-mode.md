# Plan mode

Plan mode separates investigation from implementation. Enter with `/plan`, or
send a task with `/plan <task>`. The model explores, asks about unresolved
trade-offs, and submits a complete Markdown plan. It cannot approve its own
plan. Sessions that never use planning gain no planning instructions or tool
declarations.

## Commands

| Command | Behavior |
|---|---|
| `/plan` | Enter planning; when already planning, review the latest draft |
| `/plan <task>` | Enter if needed and run the task as a planning prompt |
| `/plan off` | Leave planning without discarding the draft |
| `/plan approve [N [note]]` | Approve the latest revision, or exactly revision N, and implement in this session; a note after N is passed to the model |
| `/plan approve fresh [N [note]]` | Approve and implement in a fresh CLI session linked to the planning transcript |
| `--plan` | Enter planning on initial startup only, including when initially opening a saved session |

All commands require an idle session without queued messages. Finish or
interrupt the current turn and resolve pending input first. An explicit revision
that is no longer current is refused; run `/plan` to review again.

Without a draft, `/plan` reports “No plan submitted yet; send a task to continue
planning.” It opens no picker and starts no model request. Approval without a
draft reports “No plan to approve.” Typing a message while planning requests a
revision; it is not approval.

## What is enforced

Planning permits model-issued calls to `read`, `grep`, `find`, `ls`, `webfetch`,
`websearch`, `bash`, `powershell`, `ask_user`, and `submit_plan`. Entering plan
mode turns on `webfetch` and `websearch` unless they are turned off with
`/tools`; like the other planning tools, they stay on afterwards. Every other
tool is blocked, including file edits, MCP tools regardless of their read-only
hints, custom tools, subagents, codemode, and tool search. Nested tool calls
pass through the same gate. The planning instructions name only the tools the
session has.

Shell commands are not checked. The model is told to run only commands that
inspect, but a command can still change files. In the IDE, the editor's own
permission prompt still applies. User-started `!` commands are not gated.

This is not an operating-system sandbox. KnightCode still writes session data,
and installed extensions remain trusted code that can access files directly.
The planning gate runs before KnightCode's built-in classifier and engine
permission gates. User and project extensions load first, so their handlers may
run before it. Another extension registering `/plan`, `--plan`, or either
planning tool replaces the built-in implementation.

## Questions, submission, and review

Questions offer two to four choices, recommended first, plus a free-text answer.
The TUI shows each option's description. RPC clients receive `select` and
`input` dialogs. Cancelling a question lets the model proceed with its best
judgment; aborting ends the run. Without UI, the model takes the recommended
choice and records the decision under Assumptions.

A submitted plan contains the goal, specific changes and paths, verification
commands, and assumptions. Each submission replaces the complete draft and
increments its revision. Successful submission ends the run, including a mixed
tool-call batch; executable sibling calls are blocked. Queued user input is
preserved, not automatically run after submission.

The plan appears once in the transcript, in the submission's tool card. The TUI
then opens review below it, in the same picker as questions: Implement,
Implement in a fresh session, Keep planning, or Exit planning, plus **Revise the
plan**, which takes your feedback as the next planning message. Tab adds a note
to the highlighted choice; on an implement choice it is sent with the
approval, and on Keep planning it is sent as feedback. Escape keeps planning. Review does not open automatically on resume. Session replacement, tree navigation, or a new run cancels an open
picker. An action rechecks the shown revision before changing state.

RPC reports a submission notification; `/plan` opens its review selection.
The IDE displays the plan in the tool card and supports `/plan approve`, but
fresh-session handoff is not available there. JSON mode adds no extra output:
the submission tool-call events contain the Markdown.

## Print mode

```sh
knightcode -p --plan "Investigate the cache invalidation bug"
knightcode -p "/plan Investigate the cache invalidation bug"
knightcode --session <path-or-id> -p "/plan approve"
```

A successful planning run prints exactly the submitted Markdown. There is no
automatic headless approval. Command-triggered planning and implementation wait
for the complete run before print mode exits. Notices and refusals use stderr,
not stdout.

Approval is saved before same-session implementation begins. If dispatch
fails, the approval remains saved. Fresh handoff seeds the approved draft in a
new session, preserves the selected model and reasoning level, and dispatches
the complete plan through the replacement session's input handlers. Cancelling
the switch leaves the original planning state untouched. The original
transcript remains resumable.

## Persistence and configuration

Draft, mode, and approved revision follow the selected session branch. Exit and
approval retain the draft. Entering a new planning cycle clears approval while
retaining the previous draft; revisions continue on that branch. New sessions
start off. Resume, reload, fork, and tree navigation restore saved state rather
than reapplying `--plan`.

Planning activates `ask_user`, `submit_plan`, and any available `read`,
`grep`, `find`, and `ls` tools in one initialization checkpoint. The loadout is
kept after exit or approval. Later transitions append messages without rewriting
earlier instructions or changing the tool declarations.

`--tools` must allow both planning tools; `--exclude-tools` must not exclude
one, and `--no-tools` is incompatible. Codemode `only` mode with active codemode
is also incompatible because it hides the direct read tools. Use
`codemode.mode: "on"` instead. Entry refuses before changing state or tools.
Restoring incompatible or malformed planning state fails closed: startup or
reload reports an error and cannot make provider requests until corrected.
An incompatible tree target is cancelled before navigation.

Compaction appends a frozen recovery message containing the planning rules and
current draft, or the pinned approved plan. Overflow retries temporarily append
the same message at the request tail until it is persisted. Later revisions
never rewrite that recovery. See [Session File Format](session-format.md) for
the stored snapshots and messages.
