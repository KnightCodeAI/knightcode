# Full Tool Port — Design

**Date:** 2026-06-27
**Goal:** Implement every tool in `packages/cli/src/tools` that has source available in
`shenanigans/claude-code-source/src`, with no Anthropic-user-only (`USER_TYPE === 'ant'`) or
feature-flag guards — every tool available to all users — and wire each one into the tool registry
properly. Report at the end which tools cannot be done (no source available).

## Baseline

- `packages/cli` typechecks clean (`tsc --noEmit` → 0 errors) before any change. This is the
  verification target: every step must keep it at 0.
- The swarm subsystem (`utils/swarm/*`) was already refactored in the working tree but its public
  API (`registry.detectAndGetBackend`, `teammateLayoutManager.createTeammatePaneInSwarmView`, etc.)
  remains compatible with upstream `spawnMultiAgent.ts`. Verified by export audit.

## Tools WITH source — port + ungate + wire

| Tool | Source location | Work |
|------|-----------------|------|
| Teammate spawning (`spawnMultiAgent.ts`) | `tools/shared/spawnMultiAgent.ts` | Replace stub with full upstream impl. Add missing `utils/swarm/It2SetupPrompt.tsx`. Fixes AgentTool team/named-agent path + TeamCreate/TeamDelete/SendMessage workflow. |
| `RemoteTriggerTool` | `tools/RemoteTriggerTool/` | Port verbatim. Override `isEnabled()` to drop the GrowthBook/`AGENT_TRIGGERS_REMOTE` gate → always on. Wire into `getAllBaseTools()`. |
| `ScheduleCronTool` (CronCreate/Delete/List) | `tools/ScheduleCronTool/` + `utils/cron*.ts` | Port 3 tools + cron utilities (`cron.ts`, `cronTasks.ts`, `cronTasksLock.ts`, `cronJitterConfig.ts`, `cronScheduler.ts`). Ungate `isKairosCronEnabled` → true. Wire. |
| `LSPTool` | `tools/LSPTool/` + `services/lsp/*` | Port full LSP backend (`LSPClient`, `LSPServerManager`, `LSPServerInstance`, `LSPDiagnosticRegistry`, `config`, `passiveFeedback`) replacing the `manager.ts` stub. Wire `LSPTool` (upstream gates on `ENABLE_LSP_TOOL` env — keep that env gate as it is config, not a user-class gate, OR enable unconditionally per "all users"). |
| `BriefTool` | `tools/BriefTool/` | Assess: depends on the SendUserMessage UI channel / KAIROS view. Port `attachments.ts`, `upload.ts`, `UI.tsx`; ungate `isBriefEnabled`. Only wire if the visible-output channel is coherent in this build; otherwise document as deferred. |

## De-gating (all-users availability)

Remove `process.env.USER_TYPE === 'ant'` conditionals so the guarded tools/params are available to
everyone:
- `tools.ts`: `ConfigTool`, `TungstenTool` (if portable), MCP-resource-tool special-casing to match
  upstream `getTools()` (move out of base model pool).
- `AgentTool.tsx`: `isolation: 'remote'` schema branch, `checkPermissions` auto-mode branch,
  remote-isolation block (remote needs CCR — keep but ungate the class check).
- `runAgent.ts`: Perfetto/ant-only debug logging guards (harmless to enable).

## Tools WITHOUT source — cannot be done

No source exists in `shenanigans` for these; they are Anthropic-internal and were never extracted.
They will be reported as not-done:
`MonitorTool`, `WorkflowTool`, `ReviewArtifactTool`, `WebBrowserTool`, `SendUserFileTool`,
`SnipTool`, `PushNotificationTool`, `ListPeersTool`, `TungstenTool`, `SubscribePRTool`,
`SuggestBackgroundPRTool`, `TestingPermissionTool`, `OverflowTestTool`, `CtxInspectTool`,
`TerminalCaptureTool`, `VerifyPlanExecutionTool`.

## Verification

After each tool: `tsc --noEmit` stays at 0 errors. Run existing tool tests
(`bun test src/tools`) where present.
