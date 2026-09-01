# KnightCode → v1 Roadmap (BYOK / OpenRouter cutover)

> Working tracker. **Uncommitted** (like specs/plans). Source of truth for resuming
> across sessions. Read this + the spec before continuing.

- **Spec:** `docs/superpowers/specs/2026-05-30-byok-openrouter-cutover-design.md`
- **Plans:** `docs/superpowers/plans/` (one per phase, written just-in-time)
- **References:** `claude-code/` (primary fidelity), `opencode/` (secondary)

## Guiding principle

Make the harness (prompt, tool loop, streaming, context, compaction, rendering)
model-agnostic and claude-code-faithful, so **output quality is a pure function of
the chosen model**. BYOK OpenRouter is only the transport. v1 = today's feature set
made standalone (drop the SaaS server/accounts/billing) + a full UI revamp; no new
claude-code features. Parity is the post-v1 roadmap.

## Locked decisions (do not re-litigate)

- Pure-local BYOK. Delete `packages/server`, Clerk, Polar, Sentry, Prisma/Postgres.
- Storage: **Drizzle ORM over `bun:sqlite`** at `~/.knightcode/knightcode.db`
  (sessions scoped by `directory`; parts as JSON column for v1; normalized part
  table deferred). Already built in `packages/cli/src/lib/store/`.
- Secrets: `~/.knightcode/credentials.json` (`0600`) via `lib/credentials.ts`;
  non-secret prefs in `settings.json` via `lib/settings.ts` (`model` key already
  exists). Env overrides win. `KNIGHTCODE_HOME` relocates the dir.
- Inference: custom `ChatTransport` → `@openrouter/ai-sdk-provider` `streamText` →
  `toUIMessageStream()`; **keep `useChat` for v1** (hand-rolled loop deferred).
- Models: curated shortlist in `@knightcode/shared` (strong tool-callers,
  free→frontier) + free-form override; provider-agnostic default.
- Web: WebFetch local; WebSearch optional BYO key (graceful degrade).
- UI: **stay on OpenTUI** (claude-code is a bespoke react-reconciler renderer, not
  Ink — same family). Full structural revamp in place.
- End users need the Bun runtime (OpenTUI + bun:sqlite).

## Workflow (per [[feedback-workflow]])

- **Never commit specs/plans/this roadmap.** Commit **code only**, per finished phase.
- One phase → one **meaningfully named branch** (slugs below, not `phase-N`) → the
  **user opens the PR** → CodeRabbit + Codex review → I address feedback on the branch.
- Run `bun --cwd packages/cli run check-types` + `bun --cwd packages/cli test` before
  declaring a phase done.

## Phase status

| #   | Branch slug            | Scope                                                                                                                                                                                                                                                                               | Status                                                                            |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | `local-store`          | Drizzle/`bun:sqlite` store + `0600` credentials + `paths`                                                                                                                                                                                                                           | ✅ DONE — merged (PR #7)                                                          |
| 2   | `openrouter-inference` | `LocalChatTransport` + `resolveModel`; swap `useChat` transport; move compaction + subagent step local; curated model shortlist in `shared`                                                                                                                                         | ✅ DONE — committed `0c57c20` on branch `openrouter-inference` (awaiting user PR) |
| 3   | `strip-server`         | Repoint dialogs to local store; delete `packages/server`, OAuth, `api-client.ts`, billing/credit UI; remove Clerk/Polar/Sentry/Prisma deps. **Incl. WebFetch ported local + WebSearch stub** (see decision below)                                                                   | ✅ DONE — merged (PR #10)                                                         |
| 4   | `web-tools`            | ~~WebFetch local~~ (pulled into `strip-server`); **WebSearch BYO-key w/ graceful degrade** only                                                                                                                                                                                     | ✅ DONE — merged (PR #11)                                                         |
| 5   | `onboarding`           | First-run wizard (OpenRouter key → model pick → optional search key); replaces OAuth                                                                                                                                                                                                | ✅ DONE — merged (PR #12)                                                         |
| 6   | `ui-revamp`            | Rebuild core surfaces on OpenTUI to mirror claude-code (input box, message stream, tool/diff render, status bar, dialogs). **Incl. per-agent model picker** — let the user pin an OpenRouter model to a given subagent (Agent `model` override is alias-based today; see spec §6.9) | ⬜                                                                                |
| 7   | `npm-release`          | bin/build/`README`/version; **bundle migrations into the build artifact** (deferred from `local-store`); publish dry-run                                                                                                                                                            | ⬜                                                                                |

## `openrouter-inference` — DONE (recap)

Plan: `docs/superpowers/plans/2026-05-31-openrouter-inference.md`. Committed as one
commit `0c57c20` on branch `openrouter-inference` (user opens the PR). CLI 153 tests

- shared 16 tests green; `check-types` clean.

What landed:

- `packages/cli/src/lib/inference/`: `resolve-model.ts` (OpenRouter-canonical id +
  reasoning-effort mapping, `max→xhigh`), `system-prompt.ts` (port), `loaded-deferred-tools.ts`
  (port), `build-request-context.ts` (per-turn ctx gatherer), `compact-conversation.ts`
  (local summarize, injectable), `local-chat-transport.ts` (`ChatTransport` →
  `streamText().toUIMessageStream()`, persists via store).
- `lib/store/`: `getStore()` singleton + `conversation.ts` (`ensureSession`,
  `loadConversation`, `replaceSessionMessages`).
- Wired: `use-chat.ts` (transport + compaction + 3 patch seams), `Agent/execute.ts`
  (local `callStep`), `session.tsx`/`new-session.tsx` (active session create/load from store).
- `@knightcode/shared`: `MODEL_SHORTLIST`.

## Next phase kickoff — `strip-server` (PLANNED)

Plan: `docs/superpowers/plans/2026-05-31-strip-server.md` (11 tasks, single commit at end).
Branch `strip-server` from `main`. The main chat path is already server-independent;
this phase removes the now-unused server + deps:

- Repoint the remaining dialogs off `apiClient` to the local store: sessions-list
  (`sessions-dialog.tsx`), `stats-dialog.tsx`, `doctor-dialog.tsx`, `rename-dialog.tsx`,
  `commands.tsx` (`/reasoning` persist + `/branch`; drop `/login` `/logout` `/upgrade`
  `/usage`), `skillify.ts`. (Active chat screens already repointed.)
- Delete `packages/server`, `lib/api-client.ts`, `lib/auth/*` (OAuth), `lib/upgrade.ts`,
  `lib/http-errors.ts`, billing/credit UI, and the Prisma `packages/database`.
- Remove deps: Clerk, Polar, Sentry, Prisma/pg, Hono client usage in the CLI.
- The `model`/`metadata.credits` UI fields tied to billing get cleaned up here.

**Decision (user-approved, 2026-05-31): WebFetch pulled forward.** The web tools are the
last `apiClient` consumers, so to delete `api-client.ts` cleanly `strip-server` ports
**WebFetch** to a full local impl (SSRF guard + `html-to-text`, add the dep to CLI) and
makes **WebSearch** a graceful "not configured" stub. The `web-tools` phase therefore
shrinks to just the BYO-key WebSearch (provider + key config + onboarding wiring).

**New store helpers this phase:** `setSessionReasoningEffort`, `directorySessionStats`
(directory-scoped token/cost aggregates for the stats dialog).

**Heads-up for review:** the transport/compaction pass `tools as never` to
`validateUIMessages`/`convertToModelMessages` (CLI tsconfig is stricter than the
server's about `Tool` generic variance — mirrors the existing `compact.ts` pattern).
Old Postgres-only sessions are not migrated; sessions are now directory-scoped local
rows, so legacy ones simply won't appear (acceptable for v1).
