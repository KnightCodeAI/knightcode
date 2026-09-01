# KnightCode tool implementation status

Audit + porting effort to revive the tools that the knightcode fork stubbed out.
Source of truth for porting: `shenanigans/claude-code-source/src` (full upstream TS).

## Key finding

The fork stubbed entire **backend subsystems**, not just the tool wrappers. A tool
file can typecheck (the project's `tsc` does **not** flag missing module exports) yet
fail at **runtime** because its backend (`utils/worktree.ts`, `services/lsp/manager.ts`,
the swarm backends, etc.) is an empty stub. **Verify every tool by loading it in `bun`,
not just `tsc`.**

## ✅ Implemented, wired, runtime-verified (registry test green)

| Tool | Notes |
|------|-------|
| TaskCreate / TaskGet / TaskList / TaskUpdate | Ported from source; backend `utils/tasks.ts` was already real. Gated by `isTodoV2Enabled()` (true interactively). |
| TaskOutput | Reconstructed clean from decompiled `.tsx` (dropped React-compiler memo). |
| TaskStop | Ported; also ported `tasks/stopTask.ts` with a local `getTaskByType` dispatch (knightcode has no central task registry). |
| Sleep | **Authored from scratch** (no impl in source — only a prompt). Abort-aware wait. |
| Config | Ported (+ `utils/configConstants.ts`, + `voice/voiceModeEnabled.ts` stub). Ant-only gate removed. |
| WebSearch | Ported. Enabled because `getAPIProvider()` returns `firstParty`; works wherever the provider offers server-side search. |
| EnterWorktree / ExitWorktree | Ported tools **and** the full 1519-line `utils/worktree.ts` backend (replaced the 46-line stub) + `utils/swarm/backends/detection.ts` + `TMUX_COMMAND`. Worktree-mode gate removed (unconditional). |
| **TeamCreate / TeamDelete / SendMessage** | Ported the **entire swarm/teammate subsystem** (~40 files, ~13k lines): coordination (`teammateMailbox` 1183L, `useInboxPoller` 969L, `teamHelpers` 683L, `permissionSync` 928L, `teammate`, `teammateContext`, `leaderPermissionBridge`, `useSwarmPermissionPoller`), leaf utils (`agentId`, `peerAddress`, `words`, `spawnUtils`, `teammateInit`, `teammateLayoutManager`, `teammatePromptAddendum`, `reconnection`, `inProcessTeammateHelpers`), backends (`types`, `registry` 464L, InProcess/Pane/Tmux/iTerm, `it2Setup`, `teammateModeSnapshot`, `constants`), execution runtime (`inProcessRunner` 1552L, `spawnInProcess`, `InProcessTeammateTask`, `spawnMultiAgent` 1093L). Added `bootstrap/state` shims, `getReplBridgeHandle`, re-pointed `PermissionModeSchema`. `isAgentSwarmsEnabled()` now returns **true for all users** (opt-out via `KNIGHTCODE_CODE_DISABLE_AGENT_TEAMS`). The AgentTool teammate-spawn branch was already present and now calls the real `spawnMultiAgent`. Functionally verified: TeamCreate writes a real team to `~/.knightcode/teams/.../config.json`. (Cross-machine `bridge:` peer messaging stays disabled — that's the remote-control cloud feature.) |

All "ant-only" / feature gates on the above were removed so the tools are available to every user.

## ⚠️ Ported but NOT wired — backend still a stub

| Tool | Blocking backend |
|------|------------------|
| LSP | `services/lsp/manager.ts` is a stub: `isLspConnected()` + the language-server client are absent. Tool files are ported under `tools/LSPTool/`; re-enable in `tools.ts` once the LSP client backend is ported. |

## ⛔ Not yet portable — require a large absent runtime or Anthropic cloud

| Tool(s) | Why |
|---------|-----|
| Workflow | Workflow-scripting VM engine absent (`tasks/LocalWorkflowTask` is a stub). |
| Monitor / Snip | **Not present in the reference source at all** (bundle-only); their task backends are stubs. Would need authoring from behavior. |
| Brief, CronCreate/Delete/List, RemoteTrigger, PushNotification, SendUserFile, SubscribePR | Depend on Anthropic-internal cloud services (KAIROS, agent-triggers). Cannot function standalone for non-Anthropic / OpenRouter users regardless of porting. |

## Verification commands

```
cd packages/cli
npx tsc --noEmit                         # type check (does NOT catch missing modules)
bun test src/tools.test.ts               # registry contract test
bun -e "await import('./src/tools/<X>/<X>.js')"   # runtime load probe (authoritative)
```
