# KnightCode IDE — architecture

Status: proposed design, not yet implemented
Date: 2026-09-11
Revision: 1

A desktop IDE built on a fork of Zed, with KnightCode as its only agent, its
only inference path, and its only login. The IDE is Rust. The AI stack stays in
this repository's TypeScript packages and ships alongside it as a headless
engine binary.

---

## 0. Mandatory reading

Read completely before editing.

In this repository:

1. `AGENTS.md` — the 1,100-token floor and the layout table.
2. `packages/ai/src/auth/types.ts` — `CredentialStore`, `Credential`,
   `ProviderAuthInteraction`.
3. `packages/cli/src/core/auth-storage.ts` — the file-backed credential store
   the engine replaces.
4. `packages/ai/src/auth/oauth/anthropic.ts` — the shape every OAuth provider
   follows.
5. `packages/cli/src/core/agent-session-runtime.ts` and
   `agent-session-services.ts` — how a session is constructed headlessly.
6. `packages/cli/src/modes/rpc/rpc-mode.ts` and `rpc-types.ts` — the existing
   headless surface, and why it is not the one the IDE uses.
7. `packages/cli/src/core/extensions/loader.ts` — extension sandbox module map.
8. `scripts/build.ts` — the Bun compile pipeline and its five targets.

In the Zed source tree (v1.21.0), paths relative to its repository root:

9. `crates/acp_thread/src/acp_thread.rs` and `connection.rs` — the
   `AgentConnection` trait and the thread model the agent panel renders.
10. `crates/agent/src/native_agent_server.rs` — 102 lines; the slot KnightCode
    takes.
11. `crates/agent_servers/src/acp.rs` — `AcpConnection`, the ACP stdio client
    that is reused rather than rewritten.
12. `crates/language_model/src/language_model.rs` — `LanguageModel` (line 91)
    and `LanguageModelProvider` (line 366).
13. `crates/language_models/src/language_models.rs` —
    `register_language_model_providers` (line 216).
14. `crates/zed/src/zed/edit_prediction_registry.rs` and
    `crates/settings_content/src/language.rs` — the edit-prediction provider
    selection.

Prior art, for the sidecar lifecycle only — OpenCode, an Electron desktop app
over a headless agent server:

15. `packages/desktop/src/main/server.ts` and `sidecar.ts` — process spawn,
    readiness, and shutdown.
16. `packages/opencode/src/cli/cmd/acp.ts` — an ACP mode implemented as a
    client of its own HTTP server.

---

## 1. Problem

### 1.1 The CLI cannot be an IDE, and an IDE cannot be a plugin

KnightCode's value is in `packages/ai` (23,475 lines: 89 provider modules, 32
API adapters, 7 OAuth flows) and `packages/agent` (25,112 lines: loop, harness,
compaction). None of it is reachable from an editor today except by a human
typing in a terminal.

The obvious shortcut — register KnightCode as an external agent in stock Zed via
`agent_servers` settings — produces a product that cannot sign you in, cannot
hold its own state, and stops working until you have run `knightcode auth` in a
shell. That is a plugin, and it is explicitly not the goal.

### 1.2 An IDE has three AI seams, not one

Replacing only the agent panel produces an incoherent product. Zed's AI surfaces
are wired to three unrelated interfaces:

| Seam | Interface | Surfaces |
| --- | --- | --- |
| 1 | `acp_thread::AgentConnection` | agent panel: multi-turn, tools, diffs, permissions, plans |
| 2 | `language_model::LanguageModelProvider` | Cmd+K in a buffer, Cmd+K in the terminal, commit messages, thread titles |
| 3 | `settings::EditPredictionProvider` | Tab / next-edit prediction |

`crates/agent_ui/src/buffer_codegen.rs:18` imports `LanguageModelRegistry`
directly and never touches `AgentConnection`. Concretely: an IDE that replaces
only seam 1 shows a chat panel running on the user's Claude subscription, and
then asks that same user for an Anthropic API key the first time they press
Cmd+K. Two logins, half the product on someone else's auth.

All three seams are in scope for v1.

### 1.3 Porting the AI stack to Rust is not available

A Rust IDE can only link Rust. Porting `packages/ai`, `packages/agent`, and the
tool/skill/extension layer in `packages/cli/src/core` is roughly 80,000 lines,
and leaves two implementations to keep in step forever. It also cannot succeed
on its own terms: extensions are TypeScript modules loaded at runtime, so a
ported IDE would have to embed a JavaScript engine regardless.

A port would additionally relicense the work. Of the 237 Zed crates that declare
a license, 203 are `GPL-3.0-or-later`, including `zed`, `editor`, and
`agent_ui`; only `gpui` and 33 others are Apache-2.0. Linking the AI stack into
those crates would drag `@knightcodeai/cli` off MIT.

---

## 2. Decisions

**The engine is a peer of the CLI, not a mode of it.** `packages/ai` and
`packages/agent` are a library. Today one binary consumes them; the IDE gets a
second, `knightcode-engine`, with an API designed for an editor: accounts,
providers, models, sessions, completions, FIM, events. The CLI is not
puppeteered and the engine is not a wrapper. The rejected alternative — adding
`--mode ide` to the existing binary — keeps the front door shaped by terminal
concerns and makes every IDE-facing API change a change to the CLI's contract.

**Credentials belong to the IDE, in the OS keychain.** `CredentialStore`
(`packages/ai/src/auth/types.ts:65`) is already an interface with `read`,
`list`, and a serialized `write`. `FileAuthStorageBackend` writing
`~/.knightcode/auth.json` at mode `0600` is one implementation; the engine ships
a second backed by Keychain, Windows Credential Manager, and Secret Service. The
rejected alternative — reading the CLI's `auth.json` — makes the IDE depend on a
separate product being installed and configured, which is the plugin failure
mode in §1.1.

**Seam 1 speaks ACP over stdio.** `AcpConnection`
(`crates/agent_servers/src/acp.rs:1624`) already implements `AgentConnection`
for any ACP stdio subprocess, and `acp_thread` models tool calls, diffs,
permission requests, plans, and terminals as ACP types — 761 uses of `acp::` in
`acp_thread.rs` alone, including for Zed's own in-process native agent. Using
anything else means writing and maintaining a translation layer into types the
UI already speaks. Nothing in the product surfaces the word ACP; it is the
format of a private pipe.

**The editor owns the filesystem, not the engine.** ACP inverts control: the
agent asks the client to read and write buffers. This is why agent edits land in
unsaved buffers with per-hunk accept and reject in a multibuffer. The rejected
alternative is OpenCode's model, where the server writes files directly and the
UI watches; correct for an Electron shell with no editor of its own, wrong for a
product built on one.

**Seams 2 and 3 speak HTTP on loopback.** They want streaming chat completions
and fill-in-the-middle, not an agent protocol.
`crates/edit_prediction/src/open_ai_compatible.rs` already consumes an
OpenAI-shaped endpoint.

**The engine is an HTTP server from day one, and the ACP process is a client of
it.** Not three bolt-on endpoints. This is the layering OpenCode arrived at
after building four clients: `cli/cmd/acp.ts` boots the server in-process and
bridges ACP stdio to an SDK client pointed at it. It matters here because the
parallel agent manager — many agents, one mission-control view — needs one
server with N sessions and one event bus. ACP over stdio alone gives one
isolated subprocess per session and no shared view, which would force a rewrite
of the engine's front door later.

**Chord and CBOR stay inside the engine.** `packages/server` is already a
multi-session router with attachments and service updates, over unix sockets and
CBOR. It sits on `packages/chord`, a TypeScript-native composition runtime with
facets, replicated state, and delta codecs. A Rust client for that boundary
would couple the IDE to a TypeScript framework. The Rust-facing wire is boring
and language-neutral: ndjson JSON-RPC for ACP, HTTP and SSE for everything else.

**The Zed fork is additive and tracks upstream.** New crates plus changed
defaults. `collab`, `cloud_llm_client`, and the hosted zeta path stay in the
tree, compiled and dormant, because `client` is a dependency of `workspace`,
`project`, and `editor`, and tearing it out fights every rebase. The value is
the agent and the provider layer, not a rewritten editor.

**The fork lives in its own repository.** `KnightCodeAI/knightcode-ide`, with
Zed as a git remote, added here as a submodule at `apps/desktop/ide`. Rebasing
245 crates on roughly weekly Zed releases requires `git merge upstream/main`;
`git subtree` on a 90 MB vendored tree inside a Bun workspace is not workable,
and would put a Rust workspace inside the root `tsconfig.json`'s glob.

---

## 3. Terminology and ownership

```text
IDE        the Rust application. Editor, buffers, LSP, git, terminal,
           panels, keymaps, and every AI surface the user touches.
Engine     knightcode-engine. Headless. Inference, agent loop, tools,
           skills, extensions, compaction, sessions, credentials.
Seam       one interface in the IDE that the engine satisfies. Three of
           them, listed in §1.2.
```

### IDE

Owns:

- every pixel and every keystroke;
- buffers, undo history, and the multibuffer diff review;
- which model is selected, and the UI that selects it;
- the sign-in flow's presentation, and the browser handoff;
- the engine process's lifetime;
- workspace and project state.

The IDE holds no API key, runs no OAuth exchange, and stores no credential.

### Engine

Owns:

- every provider request and every credential;
- the agent loop, built-in tools, skills, and extensions;
- compaction and session persistence;
- the token floor. The engine's system prompt and tool definitions are the
  CLI's, unchanged. `AGENTS.md`'s constraint applies to the engine verbatim.

The engine knows nothing about editors. It never writes a file the IDE has not
asked it to write.

### Seam

Owns one interface, one direction. A seam never reaches around the engine to a
provider, and never caches a credential.

---

## 4. The three seams

### 4.1 Seam 1 — the agent panel

`crates/agent_ui/src/agent_ui.rs:489` selects the built-in agent:

```rust
Self::NativeAgent => Rc::new(agent::NativeAgentServer::new(fs, thread_store)),
```

`KnightCodeAgentServer` replaces it. It implements
`agent_servers::AgentServer`, and its `connect` spawns
`knightcode-engine acp --connect <url> --token <token>` and hands the resulting
stdio pair to the existing `AcpConnection`. `NativeAgentServer` is 102 lines and
returns `Rc<dyn acp_thread::AgentConnection>`; ours is that shape plus spawn
arguments.

Three sites downcast to the concrete native type and must be retargeted:

| Site | Purpose |
| --- | --- |
| `crates/agent_ui/src/agent_panel.rs:4596` | native-agent-only panel affordances |
| `crates/agent_ui/src/conversation_view.rs:1059` | native-vs-external branch |
| `crates/agent_ui/src/mention_set.rs:622` | constructs a server for mention resolution |

The external-agent registry (`crates/project/src/agent_server_store.rs:361`,
`CustomAgentServerSettings::Custom`) is left intact so users can still run
Claude Code or Codex inside the IDE. KnightCode is not registered there; it is
what the application is.

The ACP process attaches to the running engine rather than starting its own
agent. This is what makes a later mission-control view possible: every session,
whichever client created it, is one session on one server and appears on one
event bus.

### 4.2 Seam 2 — completion surfaces

`crates/language_models/src/language_models.rs:216` registers sixteen
providers. The fork registers one:

```rust
registry.register_provider(Arc::new(KnightCodeLanguageModelProvider::new(cx)), cx);
```

`KnightCodeLanguageModelProvider` implements `LanguageModelProvider`
(`crates/language_model/src/language_model.rs:366`): `provided_models` from
`GET /v1/models`, `is_authenticated` and `authenticate` from the accounts API,
`settings_view` rendering the IDE's own sign-in. Each `LanguageModel` streams
through `POST /v1/chat/completions`. Model it on
`crates/language_models/src/provider/open_ai_compatible.rs` (737 lines), which
is the closest existing shape.

Zed's own sixteen providers are not deleted — see §2, additive fork — but
`register_language_model_providers` no longer calls them, so they cannot appear
in a picker or ask for a key.

This lights up every non-panel surface at once: `inline_assistant.rs` (2,163
lines), `terminal_inline_assistant.rs` (468 lines), commit message generation in
`crates/git_ui/`, and thread titles.

### 4.3 Seam 3 — edit prediction

`crates/settings_content/src/language.rs:92` enumerates the providers, and
`crates/zed/src/zed/edit_prediction_registry.rs:158` maps them to a runtime
config. A `KnightCode` variant is added to both, pointing at
`POST /v1/completions`. `crates/edit_prediction/src/fim.rs` (324 lines) and
`open_ai_compatible.rs` (134 lines) already implement the request shape and the
prompt construction; the variant supplies the URL and the launch token instead
of a user-entered API key.

The default changes from `Copilot` to `KnightCode`.

---

## 5. Engine HTTP surface

One server, bound to `127.0.0.1` on an ephemeral port, chosen by the engine and
reported to the IDE on stdout at startup. Every request carries
`Authorization: Bearer <launch token>`, a 256-bit value generated by the IDE and
passed to the engine in its environment at spawn. Requests without it are
rejected before routing. This is a trust boundary: any process on the machine
can reach a loopback port, and the token is what stops one spending the user's
subscription.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | readiness; the only unauthenticated route |
| `GET` | `/v1/models` | every model from every authenticated provider |
| `POST` | `/v1/chat/completions` | seam 2; OpenAI-shaped, SSE when `stream` |
| `POST` | `/v1/completions` | seam 3; fill-in-the-middle |
| `GET` | `/v1/accounts` | credential metadata, never secrets |
| `POST` | `/v1/accounts/login` | begins a provider login |
| `GET` | `/v1/accounts/login/{id}` | login progress |
| `DELETE` | `/v1/accounts/{providerId}` | sign out, clears the keychain entry |
| `GET` | `/events` | SSE bus |

`/v1/models` returns the union across authenticated providers, carrying the
provider id, context window, capability flags, and cost metadata the model
picker needs. It is the only place the IDE learns what a model can do; the IDE
hardcodes no model list.

`/events` is one SSE stream of every engine event, with a heartbeat comment
every 15 seconds and `X-Accel-Buffering: no`. v1 subscribes for account state
changes and model-catalog refreshes. The session and agent-manager events are
carried on the same stream when they arrive; adding them requires no change to
the front door, which is the reason the bus exists in v1 at all.

`/v1/sessions` is deliberately absent from v1. Sessions are reached through ACP.

---

## 6. Credentials and sign-in

### 6.1 Storage

A `KeychainCredentialStore` implements `CredentialStore`
(`packages/ai/src/auth/types.ts:65`) against the platform secret store: Keychain
Services on macOS, Windows Credential Manager via `wincred`, Secret Service on
Linux. It preserves the interface's contract exactly, including serialized
writes — `write` takes the current credential because refresh-during-login is a
real race, and the file backend's cross-process lock has a platform equivalent
that must be used, not skipped.

Linux without a running Secret Service falls back to the file backend at
`0600`, with a visible notice in settings. Silently degrading a secret store is
not acceptable; refusing to run on a machine without a keyring is not either.

That fallback writes `~/.knightcode/engine-auth.json`, **not** the CLI's
`auth.json`. Sharing the file would make the engine read and rewrite the CLI's
credentials, and an IDE sign-out would delete the CLI's login for that provider.
The import in §6.3 is the only path between the two, and it is one-way and
explicit.

### 6.2 The login flow

`packages/ai/src/auth/oauth/anthropic.ts:234` takes an injected
`ProviderAuthInteraction`. The CLI supplies a terminal prompt. The IDE supplies
this:

```text
IDE     POST /v1/accounts/login {providerId}
engine  starts the provider's OAuth flow, opens a loopback callback
        listener, returns {loginId, authorizeUrl}
IDE     opens authorizeUrl in the system browser, shows a waiting sheet
user    signs in, provider redirects to the engine's callback
engine  exchanges the code, writes the credential to the keychain,
        emits account.changed on /events
IDE     sheet closes, model picker repopulates
```

Providers that cannot use a loopback callback fall back to a device code, which
the sheet displays with a copy button.

v1 ships the seven flows in `packages/ai/src/auth/oauth/`: Anthropic, GitHub
Copilot, OpenAI Codex, Kimi, OpenRouter, Radius, xAI — plus API keys for the
remaining providers. First run offers, in order: Continue with Claude, Continue
with ChatGPT, Continue with Copilot, Use an API key.

### 6.3 Importing from the CLI

If `~/.knightcode/auth.json` exists, first run offers to import it into the
keychain. This is a convenience and never a prerequisite. The IDE does not read
that file at any other time, does not write it, and works identically on a
machine where the CLI has never been installed.

---

## 7. Engine lifecycle

One engine process per machine, shared by every window. The lifecycle follows
OpenCode's, whose failure modes are already paid for
(`packages/desktop/src/main/server.ts` in that project).

**Spawn.** The IDE generates the launch token, spawns the engine with it in the
environment, and reads the chosen port from stdout.

**Readiness is two-phase.** Wait for the port line, then poll `GET /health`
until it answers, racing that loop against process exit. A process that started
is not a server that is listening. Start-stall timeout 60 s; on expiry, kill and
surface the engine's stderr, never a generic failure.

**Shutdown.** Graceful stop, then kill after 6 s.

**Environment.** `NO_PROXY` and `no_proxy` must contain `127.0.0.1`,
`localhost`, and `::1` before spawning, or a corporate `HTTP_PROXY` swallows the
IDE's own loopback traffic. `DEBUG` is dropped; `LD_PRELOAD` is dropped on
Linux. System CA certificates are merged into the engine's TLS defaults so
corporate TLS interception keeps working. The IDE passes its resolved project
environment — Zed already computes login-shell `PATH` for this reason, and the
engine must not repeat the work.

**Crash.** The IDE restarts the engine with backoff, up to three attempts in a
minute. Open ACP sessions do not survive a restart; the panel shows a
reconnected notice with the transcript intact, because the transcript is durable
on the engine's session storage.

**Remote.** The engine URL is a setting. Pointing it at a remote engine is
therefore possible without further design, and is out of scope for v1.

---

## 8. Fork surface

Every line changed in an upstream file is merged again on every Zed release. The
design is optimised for merge surface.

| File | Change |
| --- | --- |
| `crates/knightcode_agent/` | new crate, seam 1 |
| `crates/knightcode_models/` | new crate, seam 2 |
| `crates/knightcode_engine/` | new crate, process lifecycle and HTTP client |
| `crates/agent_ui/src/agent_ui.rs` | one match arm |
| `crates/agent_ui/src/agent_panel.rs` | one downcast |
| `crates/agent_ui/src/conversation_view.rs` | one downcast |
| `crates/agent_ui/src/mention_set.rs` | one construction |
| `crates/language_models/src/language_models.rs` | provider registration body |
| `crates/settings_content/src/language.rs` | one enum variant |
| `crates/zed/src/zed/edit_prediction_registry.rs` | one enum variant, one arm |
| `crates/zed/src/main.rs` | branding, defaults, engine startup |
| `assets/settings/default.json` | agent and prediction defaults |
| `assets/icons/`, `crates/zed/resources/` | product identity |

Nothing in `editor`, `project`, `workspace`, `terminal`, `git`, `vim`, or
`gpui`. `collab`, `cloud_llm_client`, `zeta_prompt`, and `language_models`'
sixteen provider modules are left compiled and unreferenced.

The IDE ships as `GPL-3.0-or-later`, as any Zed fork must. The engine remains
MIT and is a separate program, the same posture Zed already holds toward Claude
Code.

---

## 9. Repository layout

```text
apps/desktop/
  docs/architecture.md         this document
  docs/engine-api.md           the HTTP surface, normative
  ide/                         submodule: KnightCodeAI/knightcode-ide
  packaging/                   installers, signing, notarisation
  scripts/                     bundle the engine into the app payload

packages/cli/
  src/engine-entry.ts          new: knightcode-engine entrypoint
  src/engine/
    server.ts                  HTTP routing and the launch-token guard
    completions.ts             /v1/chat/completions, /v1/completions
    accounts.ts                /v1/accounts/*, login orchestration
    events.ts                  /events SSE bus
    keychain.ts                CredentialStore over the platform secret store
    acp/                       ACP adapter; a client of the above
```

The engine lives in `packages/cli` because the built-in tools
(`packages/cli/src/core/tools/`: bash, edit, find, grep, ls, powershell, read,
write), skills, extensions, compaction, and the system prompt live there. Moving
them to a shared package is a larger refactor with no benefit to this work, and
would touch the merge-sensitive core.

`scripts/build.ts` gains a second entrypoint and a second output name per
target, alongside the existing five.

**On binary size.** The compiled CLI is 127,741,952 bytes. The engine is the
same size class and will not be meaningfully smaller: most of it is the Bun
runtime, and `packages/cli/src/core/extensions/loader.ts:58` bundles
`@knightcode/tui` into the extension sandbox as a value import, so the terminal
UI cannot be dropped while extensions are supported. Size is not a reason to
build the engine; the API is.

---

## 10. Implementation phases and file manifest

### Phase A — engine server

`packages/cli/src/engine-entry.ts`, `engine/server.ts`, `engine/keychain.ts`,
`engine/accounts.ts`, `engine/completions.ts`, `engine/events.ts`.
`scripts/build.ts` second target.

Exit condition: `knightcode-engine` starts, prints a port, answers `/health`,
signs in to Anthropic via loopback OAuth storing to the keychain, lists models,
and streams a chat completion. Driven entirely by `curl`, no IDE.

### Phase B — ACP adapter

`packages/cli/src/engine/acp/`. Sessions, prompts, content, tool calls,
permissions, plans, terminals, usage. Budget it honestly: OpenCode's equivalent
is 3,610 lines. Protocol framing comes from the ACP SDK; the mapping does not.

Exit condition: stock Zed, configured with a `agent_servers` custom entry
pointing at the adapter, drives a full session with diff review and permission
prompts. This validates the adapter against a client we did not write, before
any fork exists.

### Phase C — the fork

Repository creation with Zed as an upstream remote. `crates/knightcode_engine`
(spawn, readiness, HTTP client), then `crates/knightcode_agent` (seam 1), then
`crates/knightcode_models` (seam 2), then the edit-prediction variant (seam 3).
Branding and defaults last.

Exit condition: one login in the IDE; agent panel, Cmd+K in a buffer, Cmd+K in
the terminal, and Tab all served by that login, with no provider dialog
reachable from any surface.

### Phase D — packaging

Windows first, per the primary development platform: MSI or NSIS, engine binary
in the payload, Authenticode signing. Then macOS notarised `.dmg`, then Linux.

Exit condition: a clean machine with no Bun, no Node, no npm, and no CLI
installs the IDE, signs in, and completes an agent turn.

### Phase E — first-run

Sign-in screen, provider choice, optional CLI credential import, model
selection, an opened project.

---

## 11. Required tests

Engine, in `packages/cli/test/engine/`, Vitest, against the faux provider in
`packages/ai/src/providers/faux.ts` per `AGENTS.md`. No live provider calls.

- `/health` answers unauthenticated; every other route rejects a missing,
  malformed, or wrong bearer token before routing;
- the server binds loopback only, and a request with a non-loopback `Host` is
  rejected;
- `/v1/chat/completions` streams SSE and terminates the stream on client
  disconnect without leaking the upstream request;
- `/v1/completions` returns FIM output for a prefix and suffix;
- `/v1/models` is empty with no credentials and never returns a secret;
- `/v1/accounts` returns metadata only; no response body on any route contains a
  token, key, or refresh token;
- a login that is abandoned expires and frees its callback listener;
- concurrent `write` calls to the keychain store serialize, and a refresh
  arriving during a login does not lose the newer credential;
- keychain unavailable on Linux falls back to the file backend at `0600` and
  reports the fallback;
- `/events` delivers `account.changed` after a login and after a sign-out, and
  emits a heartbeat.

ACP adapter, in `packages/cli/test/engine/acp/`:

- a prompt produces session updates in ACP order, and a tool call carries a diff
  the client can apply;
- a permission request blocks the turn until answered, and a denial aborts only
  that tool call;
- cancellation mid-turn leaves the session resumable;
- client disconnect terminates the adapter without orphaning the engine.

Fork, in the IDE repository, using Zed's `gpui` test harness:

- `KnightCodeAgentServer::connect` surfaces a readable error when the engine
  binary is absent, when the token is rejected, and when the process exits
  before ready;
- `KnightCodeLanguageModelProvider` reports unauthenticated with no credential,
  and `authenticate` drives the login flow rather than prompting for a key;
- no code path in the fork writes a credential to Zed's own credential
  provider.

---

## 12. Exclusions

Do not add:

- a second credential store, a credential cache in Rust, or any Rust code that
  reads `~/.knightcode/auth.json` outside the one-time import;
- a Rust port of any part of `packages/ai` or `packages/agent`, including
  "just the streaming parser";
- a Rust client for `packages/chord` or `packages/protocol`;
- `/v1/sessions`, a session browser, or agent-manager UI in v1;
- a codebase embedding index;
- browser control;
- changes to the CLI's system prompt or tool definitions to suit the IDE. The
  token floor in `AGENTS.md` binds the engine identically;
- deletion of `collab`, `cloud_llm_client`, `zeta_prompt`, or Zed's provider
  modules;
- new hard-coded model lists in Rust;
- telemetry from the IDE that the CLI does not already send.

---

## 13. Validation

After engine changes, from the repository root:

```bash
bun run check-types
cd packages/cli && bun x vitest --run test/engine
```

The fork builds and tests in its own repository with `cargo build` and
`cargo test -p knightcode_agent -p knightcode_models -p knightcode_engine`.

Before shipping a build, confirm no credential reaches the Rust side:

```bash
rg -n "api_key|API_KEY|Bearer |auth\.json|keychain|credential" \
  crates/knightcode_agent crates/knightcode_models crates/knightcode_engine
```

Expected matches are the launch token only. Any provider key, refresh token, or
`auth.json` path in the fork is a defect.

Confirm no provider dialog is reachable:

```bash
rg -n "register_provider" crates/language_models/src/language_models.rs
```

Expected: one call, `KnightCodeLanguageModelProvider`.

---

## 14. Known limitations

**Extension UI parity.** Extensions can render terminal components through
`ctx.ui.custom()`. The IDE maps `select`, `confirm`, `input`, `notify`,
`setStatus`, and `setWidget` to native dialogs — the shapes already exist as
`RpcExtensionUIRequest` in `packages/cli/src/modes/rpc/rpc-types.ts` — but
`custom()` has no editor equivalent. Extensions using it degrade to a notice in
v1, and the engine reports which extension did so.

**Tab quality.** Cursor's tab model is trained for the task. A general FIM model
reached through `/v1/completions` will not match it initially. The seam is
correct; the model choice is a tuning problem, and the setting exists so a
better model can be swapped in without a code change.

**One engine, one machine.** Two IDE windows share one engine. Two *installs*
running simultaneously, or an IDE and a CLI-launched engine, will each hold
their own process and their own port. They share the keychain, so credentials
stay consistent; sessions do not.

---

## 15. Stop condition

v1 is complete when:

- a clean machine with no Node, Bun, npm, or CLI installs the IDE and completes
  an agent turn after signing in inside the application;
- the agent panel, Cmd+K in a buffer, Cmd+K in the terminal, commit message
  generation, and Tab prediction are all served by that one login;
- no surface in the IDE can reach a provider dialog, an API key field belonging
  to Zed, or a zed.dev account;
- credentials exist only in the OS keychain, and the validation grep in §13
  finds only the launch token in the fork;
- agent edits arrive in unsaved buffers with per-hunk accept and reject;
- the engine survives a provider outage, a proxy environment, and a corporate
  TLS interception without the IDE showing a generic error;
- the fork rebases onto a current Zed release with conflicts confined to the
  files in §8;
- `bun run check-types` and the engine test suite pass, and the fork's crate
  tests pass.
