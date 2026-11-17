# Composer, conversation and requests (S5)

The public SDK owns the supported boundary. The renderer store still owns
conversation state and drafts; no extension store mirrors them.

## Implementation map

- `renderer/extensions/composer-controller.ts`: revisioned UTF-16 edits,
  editor mount identity, focus/caret, input locks and root action admission.
- `renderer/extensions/composer-root.tsx`: root lifetime, one adapter, seven
  required contribution hosts, editor events and composition-safe replacement.
- `renderer/extensions/composer-behavior.tsx`: shared suggestions, configured
  keys, attachments, submission and queue behavior. Git/workspace platform
  controls remain host bindings for S7.
- `renderer/builtins/composer/`: SDK-only frame, textarea adapter, pickers and
  contextual registry commands. Host component files are import shims.
- `renderer/builtins/thread-header/`, `conversation/`, `requests/`: SDK-only
  presenters. `renderer/extensions/conversation.tsx` supplies finite services,
  per-item selection/fallback, explicit scroller bindings and request recovery.
- `packages/cli/scripts/desktop-models.ts`: portable read-model declarations
  generated from existing protocol schemas, not a second wire contract.

## Decisions and invariants

Draft revisions advance for text or image-path changes, not selection, focus
or composition reports. Identical reports retain the store snapshot: document
selection events must not add renders to the streaming path. Edit strings
normalize CRLF and CR to LF before cursor offsets are calculated.

A native report must use its mount's last-applied revision. It may merge an
attachment-only change when its last-applied text still matches canonical
text. It cannot claim a newer writer's revision. Captured programmatic ranges
remain strictly revision checked. Missing selection is unavailable, never an
implicit insertion at the end.

Root behavior survives provider changes. Editor composition precedes shortcut
dispatch and defers replacement; popup composition does not impersonate editor
composition. Locks block input and submission, belong to the caller signal and
window host, and cannot release another owner's lock. Mount cleanup uses exact
identity, so a saved disposer cannot detach its replacement.

A failed thread start retains its input until newer composition or locking
ends, then restores it without replacing newer typing. Image-only recovery
adds no text. An admitted start still sends its original prompt, but a delayed
result cannot replace a newer view. New admission state belongs to its explicit
composer key. Saved callbacks cannot admit new actions after their root ends.

Contextual commands require composer/thread context and use the S1 registry;
they do not add duplicate global palette entries. A renderer without an
explicit thread does not borrow the currently selected thread. Item recursion
and failure fall back to ordinary presentation, including plans and steered
messages.

Request order, recovery controls and reply admission stay host-owned. A reply
must name the exact current head object and matching thread. Cancelled,
out-of-order and repeated replies return false. The server retains authority.

## External proof

The real-loader tests install the shipped examples `01-composer-action`,
`03-contenteditable` and `05-message-renderer` with native consent. They cover
selection/range insertion, focus/end/caret, popup focus return and stale edits,
locks, plain-text and image paste, native file drop, configurable keys,
suggestion navigation/dismiss/accept precedence, IME, draft/image retention,
queue/steer/stop and two-window composition-time provider changes.

The second owner's action/banner/menu/popup remains usable after switching.
Tests count one adapter, one document selection handler and all seven hosts,
exercise stale disposers and captured callbacks across thread changes, and
verify recovery from missing/duplicate hosts/editors and a failed request
presenter. Units additionally cover canonical revision races and strict
request reply identity.

## Profiler check

From `apps/desktop`, run `bun run test:profiler`. It reads the S4 composer and
transcript sources from `4c77893e1` into temporary files, uses the same current
store/transport fixture for both presentations, and removes the files afterward.
The Git history containing that commit is required.

This is development React in a real isolated Electron renderer, without
StrictMode. The transport fixture supplies 30 completed turns, one live turn
and 80 individually delivered text deltas. It starts no app server or provider.
Both presentations use the same clock, selectors, controls and input data.
Mounts settle before recording. Every turn and the composer must have equal
commit counts; duration is diagnostic, not a timing threshold.

The check also renders plans and steered messages through an item renderer and
verifies that an untargeted item has no selected-thread context. These probes
are removed before the streaming measurement.

The first comparison exposed two extra composer commits from unchanged native
selection reports. A regression test failed before snapshot deduplication.
The corrected comparison recorded **160 commits per turn and 160 composer
commits in both presentations**, with no additional streaming commits.

## Verification record

Final package, unit, E2E and unchanged-baseline results are recorded with S5 in
[parity.md](parity.md). No native macOS/Linux execution is claimed. Coordinated
backend revisions/epochs remain S6; Git/workspace and panel engines remain S7.
