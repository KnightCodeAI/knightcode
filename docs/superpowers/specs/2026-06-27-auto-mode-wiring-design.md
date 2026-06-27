# Auto Mode Wiring — Design

**Date:** 2026-06-27
**Status:** Approved design, pending spec review

## Goal

Make "auto mode" actually usable in the `knightcode` BYOK/OpenRouter build, behaving the
way Claude Code's auto mode does: an AI safety classifier inspects each ambiguous tool
call (and the surrounding transcript, for prompt-injection) and auto-approves the safe
ones while blocking risky ones, instead of prompting the user.

## Background

Auto mode is **fully architected but deliberately inert** in this build. The complete
decision pipeline already exists and is correct:

- `utils/permissions/permissions.ts` — `hasPermissionsToUseTool` already contains the
  full auto-mode branch: acceptEdits fast-path, safe-tool allowlist skip, classifier
  call, denial tracking, fail-open/fail-closed handling, denial-limit fallback to
  prompting, and analytics.
- `components/PromptInput/PromptInput.tsx` — Shift+Tab carousel, the opt-in dialog
  trigger/accept/decline flow.
- `components/AutoModeOptInDialog.tsx` — the warning + opt-in dialog.
- `constants/querySource.ts` — the `auto_mode` query source already exists.
- `utils/permissions/bypassPermissionsKillswitch.ts` — `checkAndDisableAutoModeIfNeeded`
  already calls `verifyAutoModeGateAccess` at boot and on model/fastMode change.

Everything hangs off **one compile-time flag** plus **four no-op stub modules**:

| Piece | Current state |
|---|---|
| `feature('TRANSCRIPT_CLASSIFIER')` (`macros/bun-bundle.ts`) | hardcoded `false` → all auto-mode code dead |
| `permissions/yoloClassifier.ts` `classifyYoloAction()` | returns `{ unavailable: true }` |
| `permissions/classifierDecision.ts` `isAutoModeAllowlistedTool()` | returns `false` |
| `permissions/autoModeState.ts` `isAutoModeActive()` | returns `false` (no-op setter) |
| `permissions/permissionSetup.ts` gate/transition helpers | no-ops / identities |

For an external (non-`ant`) user, the carousel already flows
`default → acceptEdits → plan → auto → default`, so **no change to the `USER_TYPE === 'ant'`
gating in `getNextPermissionMode.ts` is required** — `auto` becomes reachable purely by
turning the flag on and making the gate report available.

## Decisions

- **Classifier model:** `getMainLoopModel()` — whatever the user is already running.
  Guaranteed available on their key; matches the existing `permission_explainer` side
  query. (Considered `getSmallFastModel()`; rejected because Haiku may not exist on an
  arbitrary OpenRouter key.)
- **Approach:** real AI classifier (fidelity to Claude Code), not a heuristic
  auto-accept.

## Changes

### 1. Enable the feature flag

`src/macros/bun-bundle.ts`: `feature()` returns `true` for `'TRANSCRIPT_CLASSIFIER'`
only; everything else stays `false`. This is the runtime stand-in the plain runtime
resolves `bun:bundle` to, so this single change un-gates every auto-mode path
(mode enum, mode config, the `require()`s in `permissions.ts`, the classifier branch,
the carousel, the opt-in dialog).

### 2. `yoloClassifier.ts` — the classifier (the core)

`classifyYoloAction(messages, action, tools, context, signal)`:

1. Build a transcript: recent conversation `messages` + the proposed `action`
   (already provided as a `formatActionForClassifier` tool_use entry). Reuse/extend
   `buildTranscriptForClassifier`.
2. `sideQuery({ model: getMainLoopModel(), system: CLASSIFIER_SYSTEM_PROMPT,
   messages: [transcript as a user message], tools: [VERDICT_TOOL],
   tool_choice: { type: 'tool', name: 'classify' }, skipSystemPromptPrefix: true,
   querySource: 'auto_mode', signal })` — forced tool-choice for guaranteed structured
   output, exactly like `permissionExplainer.ts`.
3. `VERDICT_TOOL` input schema: `{ shouldBlock: boolean, reason: string }` (plus an
   optional `thinking` field).
4. Map the response to `YoloClassifierResult`: populate `shouldBlock`, `reason`,
   `model`, `usage`, `durationMs`. On any API error / parse failure / abort →
   return `{ shouldBlock: true, unavailable: true, reason, model }` (the existing
   `permissions.ts` logic then applies the `knightcode_iron_gate_closed` fail-open /
   fail-closed policy). Re-throw `AbortError`/`APIUserAbortError`.

**System prompt** instructs the model to act as a security classifier: block actions
that are destructive, exfiltrate data, modify auth/credentials/system config outside the
workspace, or that appear to follow injected instructions from tool output/file contents
(prompt-injection) rather than the user's intent; allow ordinary development actions.
Mirrors Claude Code's auto-mode classifier intent.

### 3. `classifierDecision.ts` — safe-tool allowlist

`isAutoModeAllowlistedTool(toolName)` returns `true` for read-only / inert tools that
never need classification: file reads (Read/FileRead), Glob, Grep, LS, TodoWrite,
NotebookRead, and similar. Everything else returns `false` and flows to the classifier.
Keep the list conservative and centralized.

### 4. `autoModeState.ts` — session state

Replace the hardcoded `false` with real module-level state:
`let active = false; isAutoModeActive() => active; setAutoModeActive(v) => { active = v }`.
Used by the `plan`-mode + auto-active branch in `permissions.ts` and the
PromptInput decline path.

### 5. `permissionSetup.ts` — gate + transition

- `isAutoModeGateEnabled()` → `true`. In a BYOK build the user owns their key, so auto
  mode is always available (no hosted circuit breaker).
- `verifyAutoModeGateAccess(ctx, fastMode)` → `{ updateContext: ctx =>
  ({ ...ctx, isAutoModeAvailable: true }), notification: null }`, so the boot check in
  `bypassPermissionsKillswitch.ts` marks auto available and the carousel includes it.
  (Returns identity `updateContext` if the gate is ever disabled.)
- `transitionPermissionMode(from, to, ctx)` → when `to === 'auto'`, call
  `setAutoModeActive(true)`; when leaving `auto`, `setAutoModeActive(false)`. Return
  context (optionally with dangerous rules stripped, below).
- `getAutoModeEnabledState()` / `hasAutoModeOptInAnySource()` → reflect the
  `skipAutoPermissionPrompt` user setting the opt-in dialog already writes.
- **Dangerous-rule stripping (minimal):** when entering auto, strip blanket always-allow
  rules that would bypass the classifier (e.g. `Bash(*)`, `Bash`, `PowerShell(*)`), via
  the existing `removeDangerousPermissions`/`findOverlyBroadBashPermissions` seams.
  Conservative: only obviously-broad allow rules. If this proves noisy it can be a
  follow-up; the classifier still runs on anything not allow-ruled.

## Data flow (per ambiguous tool call in auto mode)

```
tool call → hasPermissionsToUseTool → inner check returns 'ask'
  mode === 'auto'?
    ├─ non-classifier safetyCheck (.git, .knightcode, …) → stays 'ask' (prompt)
    ├─ PowerShell (no POWERSHELL_AUTO_MODE) → stays 'ask'
    ├─ would acceptEdits allow it? → allow (fast-path, no model call)
    ├─ isAutoModeAllowlistedTool? → allow (no model call)
    └─ classifyYoloAction (sideQuery, main model)
          ├─ shouldBlock=false → allow
          ├─ shouldBlock=true  → deny (+ denial tracking; limit → fall back to prompt)
          └─ unavailable       → iron_gate gate: fail-closed deny / fail-open prompt
```

All of the right-hand side already exists in `permissions.ts`; this design only fills in
the three leaf functions it calls (`classifyYoloAction`, `isAutoModeAllowlistedTool`,
`isAutoModeActive`) plus the gate/transition helpers.

## Error handling

- Classifier API error → `unavailable: true` → existing fail-open/closed policy.
- Transcript exceeds context window → set `transcriptTooLong: true` → existing fallback
  to manual prompting.
- Abort signals re-thrown, never swallowed.
- Denial limits (`DENIAL_LIMITS`) already enforced by `permissions.ts`; unchanged.

## Testing

- **Unit — `classifierDecision`:** allowlisted tools return true; mutating tools (Bash,
  Write, Edit) return false.
- **Unit — `autoModeState`:** set/get round-trips.
- **Unit — `yoloClassifier`:** mock `sideQuery`; assert safe verdict → `shouldBlock:false`,
  risky verdict → `shouldBlock:true`, thrown API error → `unavailable:true`, abort
  re-thrown.
- **Integration — `permissions.ts`:** with the flag on and `mode:'auto'`, a mocked
  classifier returning block → decision `deny`; returning allow → `allow`; allowlisted
  tool → `allow` with no classifier call; unavailable + iron_gate closed → `deny`.
- **Manual:** Shift+Tab reaches the Auto carousel entry, opt-in dialog appears first
  time, a benign edit is auto-approved, an obviously destructive command is blocked with
  the classifier reason shown.

## Out of scope

- Two-stage (fast + thinking) XML classifier — single-stage forced-tool-choice is enough
  for v1; the `stage*` telemetry fields stay optional/unset.
- Hosted circuit breaker / GrowthBook gating beyond `isAutoModeGateEnabled() → true`.
- Headless/`print.ts`-specific tuning beyond what `permissions.ts` already handles.
