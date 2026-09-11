# WP03 — the fork (Phase C)

Status: Tasks 0–7 implemented and committed; the running-IDE walk of the
model-calling surfaces is the owner's (see Validation); fork push pending
Date: 2026-09-12
Revision: 2 — implementation notes and validation results recorded

Implement this plan task by task, in order. Each task carries its own test
cycle; do not start the next until the current one's tests pass and the
build is clean. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the IDE as a Zed fork whose only agent, only inference path
and only login are KnightCode's. One sign-in inside the application, and the
agent panel, Cmd+K in a buffer, Cmd+K in the terminal, commit messages and
Tab all served by it, with no provider dialog reachable from any surface.

**Architecture:** Three new crates and a short list of one-line changes to
upstream files. `knightcode_engine` owns the engine process — spawn with a
generated token in the environment, two-phase readiness, stall timeout,
graceful stop, restart with backoff — and the HTTP client for its routes.
`knightcode_agent` is seam 1: an `AgentServer` whose `connect` spawns
`knightcode-engine acp --connect <url>` through Zed's own `AcpConnection`
and wraps the result so the panel's sign-in comes from the engine's login
options instead of a key prompt. `knightcode_models` is seams 2 and 3: a
`LanguageModelProvider` over `/v1/models` and `/v1/chat/completions`, and an
edit-prediction delegate over `/v1/completions`. The fork lives in its own
repository with Zed as an upstream remote, added here as a submodule at
`apps/desktop/ide`.

**Tech Stack:** Rust 1.97.1 (the toolchain Zed pins), gpui, Zed's
`agent_servers`, `language_model`, `open_ai`, `http_client`, `util`,
`edit_prediction` crates; `cargo test` with the gpui test harness and
`FakeHttpClient`. On the engine side, three small TypeScript changes under
`packages/cli/src/engine`, tested with Vitest and the faux provider.

**Spec:** `apps/desktop/docs/architecture.md` — §2 Decisions, §4 the three
seams, §7 Engine lifecycle, §8 Fork surface, §10 Phase C, §11 Required
tests (Fork), §12 Exclusions, §13 Validation. §4.1 and §5 as amended by
WP02.

## Global Constraints

Copied from `AGENTS.md`, the spec, and WP02. Every task's requirements
implicitly include this section.

- The fork is additive. Every line changed in an upstream file is merged
  again on every Zed release; §8 of the spec, as amended in §1.10 below, is
  the whole budget. Nothing in `editor`, `project`, `workspace`, `terminal`,
  `git`, `vim` or `gpui`.
- No Rust reads `auth.json`, caches a credential, or writes to Zed's
  credential provider. The launch token is the only secret the fork holds.
- No hard-coded model list in Rust. `/v1/models` is the only source.
- No Rust port of any part of `packages/ai` or `packages/agent`.
- Windows is the primary development platform. Every path that crosses a
  process boundary is absolute. The engine is spawned directly from its
  binary path, never through a shell (§1.1). Forward slashes in JSON.
- Nothing in WP03 touches `packages/cli/src/core`, `packages/ai` or
  `packages/agent`. The engine changes in Task 0 are confined to
  `packages/cli/src/engine-entry.ts`, `packages/cli/src/engine/server.ts`
  and `packages/cli/src/engine/completions.ts`.
- Engine tests use the faux provider only. The root `.env` is auto-loaded by
  Bun and carries real keys; every test that spawns the engine points
  `KNIGHTCODE_CODING_AGENT_DIR` at a temporary directory and sets
  `KNIGHTCODE_OFFLINE=1`, and none creates a session.
- Formatting: Rust is `cargo fmt` with Zed's `rustfmt.toml`; TypeScript is
  Prettier (tabs, 120 columns, LF). No `any`. No inline imports.
- Do not run `bun run build:cli`, `bun run build:engine`, or the full test
  suite unless asked. Task 3 needs a rebuilt engine binary once, because
  the one in `packages/cli-win32-x64/bin` (built 2026-09-11 10:14) predates
  the `acp` subcommand; the task says so and asks first.
- After Rust changes: `cargo build -p zed` must be clean of errors, and
  `cargo test -p knightcode_engine -p knightcode_agent -p knightcode_models`
  must pass. Warnings in the three new crates are fixed, not ignored.
- Do not commit unless asked. Steps that say "Commit" prepare the commit;
  ask before running it. Stage by explicit path. Never add attribution
  trailers. Commits in the fork repository follow the same message format
  with the crate as scope.
- Verify review findings by running something before calling them valid.

---

## 0. Mandatory reading

Read completely before starting Task 0. Line numbers in this repository
are as of commit `a67fc29d8` (the head of `feat/acp-adapter`, PR #173).
Line numbers in the Zed tree are as of upstream commit
`a57ba9b17c433ea1ebfdec8f649f4fa5a402d03b` (`main`, 2026-09-10T17:54:38Z),
which is the read-only copy this plan was written against; see §1.9 for
how that commit was identified and why it is the base.

In this repository:

1. `apps/desktop/docs/architecture.md` — §2, §4, §5, §7, §8, §10 Phase C,
   §11 Fork, §12, §13, §14.
2. `apps/desktop/docs/work-packages/02-acp-adapter.md` — §1.7 lines 366–392
   (the contract Zed enforces), Implementation notes lines 4640–4677, the
   stock-Zed record lines 4820–4844, and Exclusions lines 4726–4758 (what
   the adapter deliberately lacks; nothing below assumes any of it).
3. `packages/cli/src/engine-entry.ts` — whole file, 61 lines. The `acp`
   branch before the token check (26–30), the token check (32–38), the port
   line (47), and the shutdown handler (49–61), which only SIGINT and
   SIGTERM reach today.
4. `packages/cli/src/engine/server.ts` lines 76–134 — `/health` is answered
   before the Host and token checks (82–87); a wrong token is
   `401 {"error":"unauthorized"}` (95–99); `listen(0, host)` (117).
5. `packages/cli/src/engine/proxy.ts` — whole file. The IDE repeats this in
   its own process before building its HTTP client (§1.8).
6. `packages/cli/src/engine/accounts.ts` lines 14–27 (`AccountSummary`,
   `LoginOption`), 55–80 (`SerializablePrompt`, `LoginState`), 143–262
   (`createLoginRegistry`: `auth_url` and `device_code` arrive as events,
   a `pendingPrompt` parks until `POST .../submit`), 262–373 (the routes:
   `GET /v1/accounts`, `POST /v1/accounts/login {providerId, type}`,
   `GET|DELETE /v1/accounts/login/{id}`, `POST .../login/{id}/submit
   {value}`, `DELETE /v1/accounts/{providerId}`).
7. `packages/cli/src/engine/models.ts` lines 12–27 — `EngineModel`; `ref` is
   what the IDE sends back, `id` alone is ambiguous.
8. `packages/cli/src/engine/completions.ts` lines 100–191 (the chat route;
   the SSE error frame at 182 is `{error: "upstream", message}`), 193–263
   (`/v1/completions` takes `prompt` and `suffix` separately).
9. `packages/cli/src/engine/events.ts` lines 60–65 (`EngineEvent`),
   92–124 (the SSE framing: `event:` then `data:`, comments for the
   `: connected` preamble and heartbeats).
10. `packages/cli/src/engine/acp/run.ts` lines 30–36 (`parseAcpArgs`: the
    token comes from the environment) and 57–90 (`runAcp`: with
    `--connect` there is no engine boot; the client is built and the SDK
    connection runs until stdin closes).
11. `packages/cli/src/engine/acp/agent.ts` lines 62–72 (`toRequestError`:
    every engine 401 becomes `RequestError.authRequired`, including a
    rejected launch token), 353–375 (the `initialize` response: one auth
    method, `knightcode-cli`, whose `authenticate` is a no-op at 376),
    377–386 (`session/new`).
12. `packages/cli/src/engine/acp/engine-client.ts` lines 137–153 — the
    `/events` loop swallows a refused stream and retries every second, so
    a wrong token is invisible until the first request.
13. `packages/cli/test/engine/acp/entry.test.ts` lines 25–60 — how a test
    spawns an entry from source with a throwaway agent directory and
    `KNIGHTCODE_OFFLINE`; Task 0's test follows it.
14. `scripts/build.ts` lines 165–196 — `--engine` writes
    `knightcode-engine[.exe]` next to the CLI binary in
    `packages/cli-<os>-<arch>/bin/`.

In the Zed source tree, read-only, paths relative to its root:

15. `crates/agent_servers/src/agent_servers.rs` — whole file, 135 lines.
    `AgentServer` (51–101): `connect` returns
    `Task<Result<Rc<dyn AgentConnection>>>`; the six settings-backed
    default methods; `AgentServerDelegate` has private fields (33–37), so
    an external crate cannot reach its store. `load_proxy_env` (117–135).
16. `crates/agent_servers/src/acp.rs` lines 640–660 (`connect` is
    `pub` inside a private module — not reachable from another crate),
    806–1100 (`AcpConnection::stdio`, which is `pub`: takes an
    `AgentServerCommand`, spawns it through the system shell with cwd at
    the first worktree root (848–857), reads the port of nothing — it
    speaks ndjson — races the initialize request against process exit
    (966–980, 1006–1040), and builds the connection with
    `client_capabilities_for_agent` (779–804: fs read and write, terminal,
    `terminal_output` meta)), 2189–2200 and 2569–2590
    (`FakeAcpConnectionHarness` and `connect_fake_acp_connection`, the
    test-support way to get a real `Rc<AcpConnection>`).
17. `crates/agent_servers/src/custom.rs` lines 19–41 (`CustomAgentServer`
    is `pub` with `pub fn new(agent_id)`), 42–186 (its settings-backed
    defaults, keyed by agent id under `agent_servers`), 187–283 (`connect`
    reads the store's registered command; KnightCode is not registered
    there, so this path is not ours).
18. `crates/agent/src/native_agent_server.rs` — whole file, 102 lines. The
    shape `KnightCodeAgentServer` replaces; `agent_id` is
    `crate::ZED_AGENT_ID` (25). `crates/agent/src/agent.rs` line 2724 —
    `ZED_AGENT_ID` is `AgentId::new("Zed Agent")`; lines 361–400 —
    `authenticate_all_language_model_providers` calls every provider's
    `authenticate` in the background and ignores `CredentialsNotFound`.
19. `crates/agent_ui/src/agent_ui.rs` lines 424–470 (`Agent`; `From<AgentId>`
    at 439–449 maps `ZED_AGENT_ID` to `NativeAgent` and everything else to
    `Custom`, so the native slot keeps the native id), 482–497 (`server`:
    the match arm), 840–866 (the command-palette filter on the
    edit-prediction provider; `zed_predict_onboarding` is shown
    unconditionally at 862–863).
20. `crates/agent_ui/src/agent_panel.rs` lines 4590–4600 — the
    `NativeAgentServer` downcast decides whether `thread_store` is passed
    to the conversation view; 3575–3590 — a `NativeAgentConnection`
    downcast for skills refresh; 4776, 4952, 7023, 13236 — `ZED_AGENT_ID`
    as the persisted key; 5886 — the "Zed Agent" menu entry.
21. `crates/agent_ui/src/conversation_view.rs` lines 1056–1064 (the collab
    guard downcast), 1160–1180 (`new_session` failure → `AuthRequired` →
    `handle_auth_required` with the store's connection), 1454–1500
    (`handle_auth_required`: the connected state keeps its own
    connection), 1917–2050 (`authenticate`: `terminal_auth_task` first,
    else `connection.authenticate(method)`; `Ok` calls `reset`, which
    creates a new session), 2254–2380 (`render_auth_required_state`: one
    button per `connection.auth_methods()`, a spinner while
    `pending_auth_method` is set, the description as markdown), 3334–3346
    (placeholder text keyed on `ZED_AGENT_ID`).
22. `crates/agent_ui/src/mention_set.rs` lines 611–640 — reachable only
    with a `thread_store`; constructs a `NativeAgentServer` and unwraps a
    `NativeAgentConnection` downcast at 631.
23. `crates/agent_ui/src/agent_connection_store.rs` lines 107–124
    (`active_acp_connections` downcasts to `AcpConnection` for the ACP log
    view), 284–312 (`start_connection`: `connect` errors become
    `LoadError::Other(err.to_string())`).
24. `crates/acp_thread/src/connection.rs` lines 91–266 — the
    `AgentConnection` trait, every method; `impl dyn AgentConnection {
    downcast }` at 262–266 goes through `into_any`.
25. `crates/acp_thread/src/acp_thread.rs` lines 2239–2270 — `LoadError`.
26. `crates/language_model/src/language_model.rs` lines 31–60
    (`stream_in_background`), 91–230 (`LanguageModel`), 366–420
    (`LanguageModelProvider`; `settings_view` returns
    `ProviderSettingsView`; `authentication_error_message` and
    `missing_credentials_error_message` default to API-key copy), 421–470
    (`InlineProviderSettings`, `SubPageProviderSettings`), 499–515
    (`LanguageModelProviderState`: the registry observes the entity).
27. `crates/language_model/src/registry.rs` lines 24–31
    (`ConfigurationError`), 162–181 (`register_provider`), 259–281
    (`configuration_error`, `has_authenticated_provider`), 376–398
    (`refresh_fallback_model`: the first authenticated provider's
    `default_model` becomes the default when settings name none), 459–470.
28. `crates/language_model_core/src/language_model_core.rs` lines 185–245
    (`LanguageModelCompletionError`; `Other(anyhow::Error)` has `From`),
    686–693 (`AuthenticateError`); `request.rs` lines 256–267
    (`MessageContent`), 347–375 (`LanguageModelRequestMessage`,
    `string_contents`), 462–476 (`LanguageModelRequest`);
    `chat_completion.rs` lines 28–84 (`ResponseStreamResult`: a non-null
    top-level `error` must be an object with `message`), 424–452
    (`ChatCompletionEventMapper::map_stream`).
29. `crates/language_models/src/language_models.rs` lines 1–34 (imports of
    the sixteen providers), 35–60 (`init`), 216–342
    (`register_language_model_providers`: the body Task 4 replaces);
    `provider/open_ai_compatible.rs` lines 1–260 (provider, state,
    `settings_view`, `stream_completion` through `open_ai::stream_completion`
    and `RateLimiter::stream`), 340–480 (the `LanguageModel` impl;
    `ChatCompletionEventMapper` plus `stream_in_background`);
    `provider/copilot_chat.rs` lines 120–200 (an account-based provider:
    `authenticate` is non-interactive and returns `CredentialsNotFound`,
    the inline settings view holds the sign-in button, `set_api_key(None)`
    means sign out).
30. `crates/open_ai/src/open_ai.rs` lines 679–706 (`Request`), 749–790
    (`RequestMessage`, `MessageContent::Plain`), 1007–1070
    (`stream_chat_completion`: `data:` lines only, `[DONE]` ends), 1080–1140
    (`stream_completion`), 1143–1168 (`chat_completion_request`: posts to
    `{api_url}/chat/completions` with `Authorization: Bearer`), 1262
    (`From<RequestError> for LanguageModelCompletionError`).
31. `crates/codestral/src/codestral.rs` — whole file, 429 lines. The
    edit-prediction delegate shape Task 5 copies: prefix and suffix from
    `cursor_excerpt` and `compute_editable_and_context_ranges` (258–280), a
    single POST, `CurrentCompletion` with `interpolate` (69–90), `suggest`
    (358–378). `crates/edit_prediction_types/src/edit_prediction_types.rs`
    lines 168–218 — `EditPredictionDelegate`.
32. `crates/zed/src/zed/edit_prediction_registry.rs` lines 1–60 (`init`
    assigns a provider to every editor), 95–155
    (`edit_prediction_provider_config_for_settings`), 156–178
    (`EditPredictionProviderConfig` and `name`), 214–262
    (`assign_edit_prediction_provider`: the Codestral arm is
    `cx.new(|_| CodestralEditPredictionDelegate::new(http_client))`).
33. `crates/settings_content/src/language.rs` lines 86–128
    (`EditPredictionProvider`; `is_zed` and `display_name` are exhaustive
    matches); `crates/language/src/language_settings.rs` lines 530–546
    (the debounce match); `crates/edit_prediction/src/edit_prediction.rs`
    lines 2501–2540 (`is_ep_store_provider` and the
    `queue_prediction_refresh` match); `crates/edit_prediction_ui/src/
    edit_prediction_button.rs` lines 198–262 (the Codestral status-bar
    arm), 592–640 (`add_provider_switching_section`), 1488–1530
    (`get_available_providers` always offers `Zed`).
34. `crates/settings_content/src/settings_content.rs` lines 1–34 (module
    wiring), 174–260 (`SettingsContent`: a section is one `Option` field),
    557–567 (`AudioSettingsContent`: the derive set a section needs);
    `crates/settings/src/settings_store.rs` lines 60–85 (`Settings::
    from_settings(&SettingsContent)`); `crates/client/src/client.rs` lines
    153–164 (`ProxySettings`: a two-field `Settings` impl).
35. `crates/zed/src/main.rs` lines 439–450 (the login-shell environment is
    applied to the process and one oneshot announces it), 500–512 (the
    HTTP client is built from `ProxySettings`, with `NoProxy::from_env`
    read at that moment — `crates/reqwest_client/src/reqwest_client.rs`
    line 107), 680–720 (`language_models::init`, `edit_prediction_registry
    ::init`, `agent_ui::init`), 1553–1555 (first open shows onboarding);
    `crates/gpui/src/app.rs` line 75 (`SHUTDOWN_TIMEOUT` is 200 ms) and
    2354–2370 (`on_app_quit`).
36. `crates/util/src/process.rs` lines 1–131 — `Child::spawn` puts the
    child in a job object on Windows (kill on handle close, covers a crash
    of the IDE) and a new session on Unix; `kill` terminates the job;
    `crates/gpui_util/src/lib.rs` lines 22–33 — `new_std_command` sets
    `CREATE_NO_WINDOW` on Windows.
37. `crates/http_client/src/http_client.rs` lines 123–153 (`HttpClient`),
    357–378 (`read_proxy_from_env`, `read_no_proxy_from_env`), 430–470
    (`FakeHttpClient::create`, feature `test-support`);
    `crates/gpui/src/app/test_context.rs` line 386 (`opened_url`).
38. `Cargo.toml` lines 1–30 (members are listed explicitly), 284–493 (the
    workspace dependency table), 1114–1150 (lints); `assets/settings/
    default.json` lines 616 (`title_bar.show_sign_in`), 1143–1165
    (`agent`), 1858–1870 (`edit_predictions.provider` is `"zed"`), 2898
    (`agent_servers`).

Prior art, read-only. OpenCode's desktop app over a headless server — the
lifecycle's failure modes, not its code:

39. `packages/desktop/src/main/server.ts` lines 40–52 (`preferAppEnv`: the
    login shell's environment is applied to the app first), 57–160
    (`spawnLocalServer`: ready message raced against exit, a 60 s stall
    timer, health polling raced against exit, stop message then kill after
    6 s), 214–221 (`createSidecarEnv`: `DEBUG` dropped, `LD_PRELOAD` dropped
    on Linux); `index.ts` lines 95–113 (`ensureLoopbackNoProxy`). OpenCode
    has no restart with backoff; it relaunches the whole application.

---

## 1. Design

Problem, trace, solution, per decision. Each rests on lines read above and,
where marked, on four throwaway probes run on 2026-09-11 (deleted
afterwards) whose observations the tests in Tasks 0, 2 and 3 make
permanent.

### 1.1 The IDE spawns the engine directly and proves the token first

The engine prints one JSON line and then serves `/health` unauthenticated
(`server.ts` 82–87). A process that has printed the line is not a server
that is listening, and a server that answers `/health` has not proved the
token: `/health` is the one route that never sees it.

Verified (probe 2): `bun run packages/cli/src/engine-entry.ts` with a
48-character token printed `{"type":"listening","port":54376}`;
`GET /health` with no header was `200 {"status":"ok"}`;
`GET /v1/accounts` with a different 48-character bearer was
`401 {"error":"unauthorized"}`; with the right one, `200` with zero
accounts and seven OAuth login options (anthropic, github-copilot,
kimi-coding, openai-codex, openrouter, radius, xai). With no token the
process exited `2` and wrote `KNIGHTCODE_ENGINE_TOKEN must be set to at
least 32 characters` to stderr — an exit before ready whose reason is on
stderr, which is why stderr is kept and surfaced.

Verified (probe 3): the adapter, started with `--connect <url>` and a
token the engine did not issue, answered `initialize` normally
(`protocolVersion 1`, one auth method `knightcode-cli`) and failed
`session/new` with `-32000 Authentication required`, details
`POST /v1/sessions failed with 401`. `toRequestError` (`agent.ts` 62–72)
turns every 401 into `authRequired`, and the adapter's `/events` loop
(`engine-client.ts` 137–153) swallows the refused stream. A token mismatch
between the IDE and the engine it spawned would therefore surface as a
sign-in prompt, not as the bug it is.

Verified (probe 2, Windows): the engine spawned through a shell wrapper
(`shell: true`, the scoop shim) survived `kill()` of the wrapper; the
engine stayed listening on its port and had to be terminated by PID. Zed's
`util::process::Child` puts the child in a job object that kills the whole
tree (process.rs 55–97), and `new_std_command` hides the console window;
both only help if the IDE execs the binary itself.

Solution: readiness is three-phase — the port line, then `GET /health`
until `200`, then `GET /v1/accounts` with the token — every phase raced
against process exit and against one 60 s stall timer; on expiry the
process is killed and the error carries the last lines of stderr. The
binary is spawned directly through `util::process::Child`, never through a
shell. `KnightCodeAgentServer::connect` never spawns the adapter until the
engine reports `Ready`, so the adapter's token is one the engine has
already accepted, and the panel's `auth_required` means exactly what it
says: no usable credential.

### 1.2 The engine stops on stdin, restarts on its old port

`engine-entry.ts` 49–61 stops the engine on SIGINT or SIGTERM only. A GUI
process on Windows cannot send either; `Child::kill` is `TerminateProcess`
through the job (process.rs 123–131). gpui gives quit handlers 200 ms in
total (`app.rs` 75), so no six-second wait fits inside a quit. On Unix the
wrapper does not kill on drop (process.rs; no `kill_on_drop`), so an engine
whose IDE died stays alive.

Verified (probe 2): two seconds after its stdin was closed the engine was
still alive; the adapter, by contrast, exited `0` when its stdin closed
(`run.ts` 84–87), which is the model.

After an engine crash the adapter processes the panel holds are pointed at
a dead port, and their `/events` loop retries that port forever
(`engine-client.ts` 147–152). The IDE cannot reach those children:
`AcpConnection` owns them.

Solution (Task 0, this repository): the engine also shuts down when its
stdin closes, which is platform-neutral, is what the adapter already does,
and makes an orphaned engine exit on every platform; and it accepts
`KNIGHTCODE_ENGINE_PORT` so a restart can reuse the port the first process
reported. The IDE's stop is: close stdin, wait up to 6 s, kill. At quit it
closes stdin and returns; the job object and the stdin EOF cover the rest.
A restart reuses the token and pins the port; if binding fails the engine
exits before ready (a readable `EADDRINUSE` on stderr) and the next attempt
does not pin. The adapter's reconnect loop then finds the new engine by
itself; its sessions are gone (`404 not_found` on the next prompt, which
Zed shows on the thread), and a new thread works. §7's "reconnected notice
with the transcript intact" is satisfied by Zed's own error on the thread
plus the transcript that is already rendered; nothing is replayed.

### 1.3 KnightCode takes the native slot with the native id

`Agent::from(AgentId)` (`agent_ui.rs` 439–449) maps `ZED_AGENT_ID` to
`Agent::NativeAgent` and any other id to `Agent::Custom`, whose `server`
is a `CustomAgentServer` that looks itself up in the external-agent
registry and fails with "is not registered" (`custom.rs` 250–257). The
persisted selected agent (`agent_panel.rs` 4776), thread metadata rows,
draft prompts and the follow toggle all key on the same id.

Solution: `KnightCodeAgentServer::agent_id` returns `agent::ZED_AGENT_ID`
— the slot, not a new registration. The value of that static changes from
`"Zed Agent"` to `"KnightCode"` in Task 6 (branding), which is one string
in `crates/agent/src/agent.rs` and carries the display name everywhere the
id is shown. The `Agent::NativeAgent` match arm in `Agent::server` is the
only construction site that changes.

### 1.4 The three downcasts stay

§4.1 lists three `NativeAgentServer` downcasts to retarget. Traced:

- `agent_panel.rs` 4593–4597 passes `thread_store` to the conversation
  view only for the native server. `thread_store` is what enables
  `@thread` mentions (`message_editor.rs` 95–101) and thread summaries,
  which `mention_set.rs` 622–631 serves by constructing a
  `NativeAgentServer` and unwrapping a `NativeAgentConnection` downcast.
  Retargeting the panel's downcast to `KnightCodeAgentServer` would pass a
  `ThreadStore`, offer `@thread`, and panic at that unwrap. Not retargeted:
  the affordance is a native-agent internal an ACP agent cannot serve, and
  `session/load` is a WP02 exclusion.
- `conversation_view.rs` 1058–1064 refuses external agents in collab
  projects. `collab` is compiled and dormant in the fork (§2); the branch
  is unreachable, and retargeting it would let a collab guest spawn a
  local engine against a remote project, which is undefined. Not
  retargeted.
- `mention_set.rs` 622 is reachable only with a `thread_store`, which the
  first decision withholds. Not retargeted.

So the fork changes one line in `agent_ui.rs` and none in the other three
files, which is the path stock Zed took for the WP02 validation: a custom
agent with no thread store. §8 keeps the three entries as budget, unspent.

### 1.5 Sign-in is a wrapper around `AcpConnection`, not a change to it

When `session/new` fails with `auth_required`, the panel renders one button
per `connection.auth_methods()` and, on click, calls
`connection.authenticate(method)`; `Ok` re-creates the session
(`conversation_view.rs` 2254–2380, 1917–2050). The adapter advertises one
method whose `authenticate` is a no-op (`agent.ts` 363–375), so out of the
box the panel would loop: button, `Ok`, `session/new`, `401`, button. The
IDE owns the sign-in and the browser handoff (§3); the engine's login
options are `GET /v1/accounts`'s `loginOptions`, and the flow is
`POST /v1/accounts/login` then polling (§6.2). Changing `AcpConnection` is
an upstream edit in a 5,000-line file.

Trace: the connection the panel renders and authenticates through is the
one the connection store returned from `connect`
(`conversation_view.rs` 1469–1470, 3434–3446), and `into_any` is the only
way a `dyn AgentConnection` is downcast (`connection.rs` 262–266). The
one downcast to `AcpConnection` in the tree is the ACP log view
(`agent_connection_store.rs` 115).

Verified (probe 1, standalone Rust): a wrapper implementing the same
trait shape whose `into_any` returns its inner `Rc<Inner>` overrides
`auth_methods`, delegates a `self: Rc<Self>` method, passes
`downcast::<Inner>()` and fails `downcast::<Wrapper>()`.

Solution: `KnightCodeConnection { inner: Rc<AcpConnection>, methods,
engine }` implements `AgentConnection` by delegation, overriding
`auth_methods` (the engine's OAuth login options as `AuthMethod`s) and
`authenticate` (start the login, open the URL the engine reports with
`cx.open_url`, poll until complete, `Ok`), and `into_any` returns the
inner so the ACP log keeps working. API-key options are not buttons in the
panel; the callout's description points at Settings > AI, where the
provider's settings view (Task 4) takes a key. `authenticate` on the
adapter side stays a no-op and is never called.

### 1.6 Seam 2 is a text-only OpenAI client over Zed's own parser

`/v1/chat/completions` accepts `system`, `user` and `assistant` messages
with string content and nothing else (`openai.ts` 41–63). The seam-2
surfaces send text: inline assist, terminal assist, commit messages,
thread titles. `open_ai::stream_completion` (open_ai.rs 1080–1140) already
does the POST, the bearer header, the SSE line reading and the `[DONE]`
handling, and `ChatCompletionEventMapper` turns chunks into
`LanguageModelCompletionEvent`s; `open_ai_compatible.rs` 340–420 is that
composition. `into_open_ai` lives in `language_models`, which will depend
on `knightcode_models`, so it is not reusable without a cycle — and it
builds tool definitions the engine would reject anyway.

Solution: `knightcode_models::request::to_request` flattens each message
with `string_contents` and maps roles; `KnightCodeLanguageModel::
stream_completion` calls `open_ai::stream_completion(http, "KnightCode",
"{engine}/v1", token, request, &CustomHeaders::default())` under a
`RateLimiter` and maps with `ChatCompletionEventMapper`. `api_url` is the
engine URL plus `/v1` because the helper appends `/chat/completions`.
Model ids are the engine's `ref` (provider-qualified); names carry the
engine provider so five `claude-opus-5` entries are distinguishable.
`authenticate` is non-interactive (`copilot_chat.rs` 123–129 is the
precedent): it refreshes accounts and models from the engine and returns
`CredentialsNotFound` when there is nothing to use, which the startup
sweep ignores (`agent.rs` 373–378). The registry then picks our
`default_model` as the fallback when the user's settings name none
(`registry.rs` 376–398), so Cmd+K works after sign-in with no model
chosen.

The engine's streamed error frame is `{"error":"upstream","message"}`;
Zed's parser requires `error` to be an object with `message`
(`chat_completion.rs` 52–58) and would report a deserialisation failure
instead of the upstream message. Task 0 changes the frame to
`{"error":{"type":"upstream","message"}}`; the non-streaming 502 body is
unchanged because Zed reads it as text.

### 1.7 Seam 3 is a Codestral-shaped delegate, and the variant costs six files

`EditPredictionProvider` is matched exhaustively in six places
(`language.rs` 106–127, `edit_prediction_registry.rs` 111–155,
`agent_ui.rs` 840–860, `edit_prediction.rs` 2501–2540,
`edit_prediction_button.rs` 85–536, `language_settings.rs` 530–546). §8
budgets two files. Traced alternatives: routing KnightCode through the
`Zed` value keeps the status-bar button's zed.dev sign-in UI reachable
(`edit_prediction_button.rs` 347–420); through `OpenAiCompatibleApi` puts
the engine URL — an ephemeral port — in user settings and the token in
Zed's credential provider (`open_ai_compatible.rs` 40–47 in
`edit_prediction`), which §12 forbids. The FIM path also sends one
formatted `prompt` (`fim.rs` 96–101), not `prompt` and `suffix`.

Solution: a `KnightCode` variant, six files, every arm one to three lines
except the status-bar arm, which is a reduced copy of Codestral's (icon,
tooltip, the language-settings menu; no provider-switching section, so no
other provider is reachable from the button). The delegate is
`KnightCodeEditPredictionDelegate` in `knightcode_models`, modelled on
`CodestralEditPredictionDelegate` line for line: prefix and suffix from
`cursor_excerpt`, one `POST /v1/completions {model, prompt, suffix,
max_tokens}`, `CurrentCompletion::interpolate`. The model is
`knightcode.edit_prediction_model` when set, else the provider's default
model, read through `LanguageModelRegistry` so no second list exists.
`default.json` sets `edit_predictions.provider` to `knightcode`.

### 1.8 One settings section, and the environment before the HTTP client

§7 makes the engine URL a setting, §14 wants the Tab model swappable
without a code change, and development needs a way to point the IDE at a
binary that is not yet bundled (Phase D). Zed's settings are one
`SettingsContent` struct (`settings_content.rs` 174); a new key is one
`Option` field plus a content struct.

Solution: one section, `knightcode`, with `engine_path` (absolute path;
default: `KNIGHTCODE_ENGINE_PATH`, then `knightcode-engine[.exe]` next to
the IDE executable), `engine_url` (attach instead of spawn; needs
`KNIGHTCODE_ENGINE_TOKEN` in the IDE's environment; out of scope for v1
beyond existing) and `edit_prediction_model`. `EngineSettings` implements
`Settings` in `knightcode_engine`. Changing `engine_path` restarts the
engine.

Zed's HTTP client reads `NO_PROXY` once, when it is built
(`reqwest_client.rs` 107; `main.rs` 504–510). The engine and the adapter
each fix `NO_PROXY` for themselves (`proxy.ts`), but the IDE's own calls
to the engine go through that client. Solution: `knightcode_engine::
environment::ensure_loopback_no_proxy()` runs in `main.rs` before the
client is built, on the process environment, which the engine, the adapter
and every terminal then inherit. `HTTP(S)_PROXY` from Zed's `ProxySettings`
is passed to the engine through `agent_servers::load_proxy_env`, so a proxy
configured in settings reaches provider traffic.

### 1.9 The base is a `main` commit, recorded, not a tag

The read-only tree declares `version = "1.21.0"` and `RELEASE_CHANNEL`
`dev`. Upstream tags on 2026-09-11 end at `v1.19.2` (stable, the client
that validated WP02) and `v1.20.0-pre`; no `v1.21` tag exists. Every line
number above is from the read-only tree, so the base is the commit that
tree is.

Verified (probe 4): a blobless shallow clone of upstream `main`
(`--filter=blob:none --depth 400`) was searched for commits whose
`Cargo.lock`, `rust-toolchain.toml`, `crates/agent_servers/src/acp.rs`,
`crates/zed/src/main.rs` and `crates/language_models/src/language_models.rs`
tree entries all equal the read-only tree's blob hashes. The run of
matches spans 3405c42 (16:24:26Z) to 1c3d902 (2026-09-11 09:16Z); the
archive's file mtime, 17:54:38, equals the commit time of
`a57ba9b17c433ea1ebfdec8f649f4fa5a402d03b` to the second. That is the
base. Also verified: `rustup` installed the pinned `1.97.1` toolchain with
its components and targets on this machine, and `cargo metadata --locked`
resolved the workspace (1.5 MB of metadata, exit 0) — the toolchain works
here before Task 1 spends an hour on the first build.

Solution: Task 1 clones upstream, checks out that commit, tags it
`knightcode-base` in the fork, and records commit, date and the nearest
tags in the fork's `README.md`. Rebasing onto `v1.21.0` when it is cut is
a `git merge` of a tag that already contains the base.

### 1.10 Amendments to architecture.md

- §4.1 says `connect` "hands the resulting stdio pair to the existing
  `AcpConnection`". `AcpConnection::stdio` takes an `AgentServerCommand`
  and spawns it itself (acp.rs 806–870); there is no constructor over a
  pair. The sentence becomes: "its `connect` builds an `AgentServerCommand`
  for `knightcode-engine acp --connect <url>` with the token in the
  command's environment and passes it to `AcpConnection::stdio`."
- §4.1's three downcasts: "must be retargeted" becomes "are left in
  place; see WP03 §1.4".
- §7 "Graceful stop, then kill after 6 s" becomes "closing the engine's
  stdin, then kill after 6 s; at quit, stdin only". Add: "A restart
  reuses the token and the port."
- §8 table gains: `crates/settings_content/src/settings_content.rs` (one
  section), `crates/edit_prediction/src/edit_prediction.rs` (two arms),
  `crates/edit_prediction_ui/src/edit_prediction_button.rs` (one arm),
  `crates/language/src/language_settings.rs` (one arm),
  `crates/agent/src/agent.rs` (one string), `crates/release_channel/
  src/lib.rs` (four strings), and the manifests: root `Cargo.toml` (three
  members, three workspace dependencies), `Cargo.lock`, and one
  dependency line each in `crates/agent_ui`, `crates/language_models`,
  `crates/edit_prediction_ui`, `crates/zed`. The three `agent_panel.rs`,
  `conversation_view.rs`, `mention_set.rs` rows are marked unspent.
- §9 file manifest: `engine-entry.ts` "the port line" gains "and the
  stdin-EOF shutdown".

All are one-line edits, made in Task 1 in the same PR as the submodule.

### 1.11 Wire contract

What the fork calls, all loopback, all behind the launch token except
`/health`:

| Who | Method | Path | Purpose |
| --- | --- | --- | --- |
| engine | `GET` | `/health` | readiness phase two |
| engine | `GET` | `/v1/accounts` | readiness phase three (token), accounts, login options |
| engine | `GET` | `/events` | `account.changed`, `models.changed` |
| engine | `POST` | `/v1/accounts/login` | `{providerId, type}` → `{loginId}` |
| engine | `GET` | `/v1/accounts/login/{id}` | `LoginState` |
| engine | `POST` | `/v1/accounts/login/{id}/submit` | `{value}` |
| engine | `DELETE` | `/v1/accounts/login/{id}` | cancel |
| engine | `DELETE` | `/v1/accounts/{providerId}` | sign out |
| models | `GET` | `/v1/models` | the catalog |
| models | `POST` | `/v1/chat/completions` | seam 2, `stream: true` |
| models | `POST` | `/v1/completions` | seam 3 |
| agent | — | `knightcode-engine acp --connect <url>` | seam 1, token in the environment |

Engine environment at spawn: the IDE's process environment (login shell
applied), plus `KNIGHTCODE_ENGINE_TOKEN`, `KNIGHTCODE_ENGINE_PORT` on
restart, `NO_PROXY`/`no_proxy` with loopback, `HTTP(S)_PROXY` from Zed's
settings; minus `DEBUG`, and `LD_PRELOAD` on Linux. stdin piped, stdout
piped, stderr piped.

---

## File structure

This repository (Task 0, Task 1):

```text
packages/cli/src/engine-entry.ts              stdin-EOF shutdown; KNIGHTCODE_ENGINE_PORT (modify)
packages/cli/src/engine/server.ts             `port` option (modify)
packages/cli/src/engine/completions.ts        SSE error frame shape (modify)
packages/cli/test/engine/engine-entry.test.ts port line, pinned port, exit on stdin end (new)
packages/cli/test/engine/completions.test.ts  the frame is an object (modify)
.gitmodules, apps/desktop/ide                 the submodule (new)
apps/desktop/docs/architecture.md             §1.10 amendments (modify)
```

The fork, `KnightCodeAI/knightcode-ide`, paths relative to its root. New:

```text
crates/knightcode_engine/Cargo.toml
crates/knightcode_engine/src/knightcode_engine.rs   init, global, re-exports
crates/knightcode_engine/src/settings.rs            EngineSettings
crates/knightcode_engine/src/environment.rs         no_proxy, engine_environment, locate_binary (pure)
crates/knightcode_engine/src/process.rs             EngineProcess: spawn, readiness, stop (smol, no gpui)
crates/knightcode_engine/src/client.rs              EngineClient: accounts, models, login, completions
crates/knightcode_engine/src/engine.rs              Engine entity: status, restart, events
crates/knightcode_agent/Cargo.toml
crates/knightcode_agent/src/knightcode_agent.rs     KnightCodeAgentServer
crates/knightcode_agent/src/connection.rs           KnightCodeConnection (delegating wrapper)
crates/knightcode_models/Cargo.toml
crates/knightcode_models/src/knightcode_models.rs   provider, state, re-exports
crates/knightcode_models/src/request.rs             LanguageModelRequest -> open_ai::Request (pure)
crates/knightcode_models/src/model.rs               KnightCodeLanguageModel
crates/knightcode_models/src/sign_in.rs             the settings view
crates/knightcode_models/src/edit_prediction.rs     KnightCodeEditPredictionDelegate
README.md                                           base commit, upstream remote, merge procedure
```

Upstream files changed, with the budget from §1.10:

```text
Cargo.toml                                              3 members, 3 workspace deps
crates/agent_ui/Cargo.toml                              1 dep
crates/agent_ui/src/agent_ui.rs                         1 match arm; 1 palette alternative; 2 palette lines removed
crates/language_models/Cargo.toml                       1 dep
crates/language_models/src/language_models.rs           registration body; unused imports removed
crates/settings_content/src/settings_content.rs         1 section
crates/settings_content/src/language.rs                 1 variant, 2 arms
crates/language/src/language_settings.rs                1 arm
crates/edit_prediction/src/edit_prediction.rs           2 arms
crates/edit_prediction_ui/Cargo.toml                    1 dep
crates/edit_prediction_ui/src/edit_prediction_button.rs 1 arm
crates/zed/Cargo.toml                                   2 deps
crates/zed/src/zed/edit_prediction_registry.rs          1 variant, 3 arms
crates/zed/src/main.rs                                  no_proxy, engine init, quit, palette, first open
crates/agent/src/agent.rs                               1 string
crates/agent_ui/src/agent_panel.rs                      1 string
crates/release_channel/src/lib.rs                       4 strings
assets/settings/default.json                            3 keys
```

Budget: `knightcode_engine` about 900 lines, `knightcode_agent` about 350,
`knightcode_models` about 900, plus about 900 of tests. Upstream lines
changed: under 120. If a task runs well past its estimate, stop and
reconsider before continuing.

## Task 0: Engine prerequisites (this repository)

**Files:**
- Modify: `packages/cli/src/engine-entry.ts`
- Modify: `packages/cli/src/engine/server.ts`
- Modify: `packages/cli/src/engine/completions.ts`
- Modify: `packages/cli/test/engine/completions.test.ts`
- Test: `packages/cli/test/engine/engine-entry.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `StartEngineServerOptions.port?: number` — `0` or absent means
    ephemeral; a pinned port that cannot be bound rejects `startEngineServer`.
  - `KNIGHTCODE_ENGINE_PORT` read by `engine-entry.ts`; a value that is not
    an integer in `1..65535` is exit `2` with a message on stderr.
  - The engine exits `0` when its stdin reaches end of file, through the
    same `shutdown` SIGINT and SIGTERM use.
  - The streamed error frame is
    `event: error` / `data: {"error":{"type":"upstream","message":"..."}}`.

Three behaviours the fork's lifecycle rests on (§1.2, §1.6), each a few
lines, all under `packages/cli/src/engine`. The engine is spawned with a
piped stdin from now on; a caller that ignores stdin gets an engine that
exits at once, which is the intended reading of "the parent is gone".

- [x] **Step 1: Write the failing tests**

```ts
// packages/cli/test/engine/engine-entry.test.ts
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const ENTRY = resolve(import.meta.dirname, "../../src/engine-entry.ts");
const TOKEN = "0123456789abcdef".repeat(3);

interface Run {
	child: ChildProcess;
	stdout: string[];
	stderr: string[];
}

describe("engine entry", () => {
	const runs: Run[] = [];
	const dirs: string[] = [];

	afterEach(() => {
		for (const run of runs.splice(0)) run.child.kill();
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	// A throwaway agent directory, so no credential of the developer's is read,
	// and no session is ever created: nothing here can bill anything.
	function start(env: Record<string, string>): Run {
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-engine-entry-"));
		dirs.push(agentDir);
		const child = spawn("bun", ["run", ENTRY], {
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				KNIGHTCODE_CODING_AGENT_DIR: agentDir,
				KNIGHTCODE_OFFLINE: "1",
				KNIGHTCODE_ENGINE_TOKEN: TOKEN,
				...env,
			},
		});
		const run: Run = { child, stdout: [], stderr: [] };
		child.stdout!.on("data", (chunk: Buffer) => run.stdout.push(chunk.toString("utf-8")));
		child.stderr!.on("data", (chunk: Buffer) => run.stderr.push(chunk.toString("utf-8")));
		runs.push(run);
		return run;
	}

	async function portOf(run: Run): Promise<number> {
		await waitFor(() => run.stdout.join("").includes("\n"), 30_000);
		const line = JSON.parse(run.stdout.join("").split("\n")[0]) as { type: string; port: number };
		expect(line.type).toBe("listening");
		return line.port;
	}

	function exitOf(run: Run, ms: number): Promise<number | null> {
		return Promise.race([
			new Promise<number | null>((resolveExit) => run.child.once("exit", (code) => resolveExit(code))),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error("the engine did not exit")), ms)),
		]);
	}

	test("prints the port line, exits when stdin closes, and binds a pinned port on the next run", async () => {
		const first = start({});
		const port = await portOf(first);
		expect(port).toBeGreaterThan(0);
		expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
		first.child.stdin!.end();
		expect(await exitOf(first, 15_000)).toBe(0);

		const second = start({ KNIGHTCODE_ENGINE_PORT: String(port) });
		expect(await portOf(second)).toBe(port);
		second.child.stdin!.end();
		expect(await exitOf(second, 15_000)).toBe(0);
	}, 90_000);

	test("a pinned port that is taken is an exit before ready with the reason on stderr", async () => {
		const blocker = createServer();
		await new Promise<void>((resolveListen) => blocker.listen(0, "127.0.0.1", resolveListen));
		const port = (blocker.address() as AddressInfo).port;
		try {
			const run = start({ KNIGHTCODE_ENGINE_PORT: String(port) });
			expect(await exitOf(run, 30_000)).not.toBe(0);
			expect(run.stderr.join("")).toContain("EADDRINUSE");
			expect(run.stdout.join("")).toBe("");
		} finally {
			blocker.close();
		}
	}, 45_000);

	test("a pinned port that is not a port is exit 2", async () => {
		const run = start({ KNIGHTCODE_ENGINE_PORT: "eighty" });
		expect(await exitOf(run, 30_000)).toBe(2);
		expect(run.stderr.join("")).toContain("KNIGHTCODE_ENGINE_PORT");
	}, 45_000);
});

async function waitFor(predicate: () => boolean, ms: number): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolveTick) => setTimeout(resolveTick, 25));
	}
}
```

In `packages/cli/test/engine/completions.test.ts`, the streamed-failure
test (line 271) gains one assertion after `expect(text).toContain("event:
error")`:

```ts
		const frame = text.split("\n").find((line) => line.startsWith("data:"))!;
		expect(JSON.parse(frame.slice("data:".length)) as unknown).toMatchObject({
			error: { type: "upstream", message: expect.any(String) },
		});
```

(The first `data:` line of that response is the error frame because the
faux response fails before any text delta; if a later change makes the
faux model emit text first, pick the last `data:` line instead.)

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd packages/cli && bun x vitest --run test/engine/engine-entry.test.ts test/engine/completions.test.ts`
Expected: the first test times out at `exitOf` (the engine ignores stdin),
the second fails at `portOf` (a pinned port is ignored, so the engine binds
another one and prints it), the third fails at the exit code, and the
completions assertion fails on the shape.

- [x] **Step 3: Write minimal implementation**

`packages/cli/src/engine/server.ts`: add `port?: number` to
`StartEngineServerOptions` with the doc comment "`0` or absent: ephemeral.
A pinned port that cannot be bound rejects." and change line 117 to
`server.listen(options.port ?? 0, host, () => {`.

`packages/cli/src/engine-entry.ts`, after the token check:

```ts
// A restart pins the port the previous process reported, so the adapter
// processes the IDE's panel already holds find the new engine where they
// left the old one. Absent or 0 is an ephemeral port, as before.
const pinned = process.env.KNIGHTCODE_ENGINE_PORT;
const port = pinned === undefined || pinned === "" ? 0 : Number(pinned);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
	console.error("KNIGHTCODE_ENGINE_PORT must be an integer between 1 and 65535");
	process.exit(2);
}
```

and `startEngineServer({ token, port, routes: engineRoutes(ctx, sessions) })`.
After the SIGTERM handler:

```ts
// The IDE holds the other end of stdin. When that end closes — a quit, a
// crash, a deliberate stop — the engine must not outlive it, on any platform:
// a GUI process on Windows can send no signal, and gpui gives quit handlers
// 200 ms. This is what the ACP adapter already does with its own stdin.
process.stdin.once("end", shutdown);
process.stdin.once("error", shutdown);
process.stdin.resume();
```

A pinned port that is in use rejects `startEngineServer`; the top-level
`await` then throws, Bun prints `listen EADDRINUSE: address already in use
127.0.0.1:<port>` and exits `1`, before the port line. That is the
"readable exit before ready" the IDE surfaces; nothing else is needed.

`packages/cli/src/engine/completions.ts` line 182:

```ts
					res.write(`event: error\ndata: ${JSON.stringify({ error: { type: "upstream", message: failure } })}\n\n`);
```

with the comment above it gaining: "The frame is OpenAI's envelope — an
`error` object with `message` — because Zed's stream parser rejects a
string `error` and would report its own deserialisation failure instead
of the upstream message."

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd packages/cli && bun x vitest --run test/engine/engine-entry.test.ts test/engine/completions.test.ts test/engine/server.test.ts test/engine/acp/entry.test.ts`
Expected: PASS. `entry.test.ts` still passes: the adapter's in-process
engine never reads `KNIGHTCODE_ENGINE_PORT` and does not touch stdin.

- [x] **Step 5: Type check and commit**

```bash
bun run check-types
```

```bash
git add packages/cli/src/engine-entry.ts packages/cli/src/engine/server.ts packages/cli/src/engine/completions.ts packages/cli/test/engine/engine-entry.test.ts packages/cli/test/engine/completions.test.ts
git commit -m "feat(engine): stop on stdin EOF, pin the port on restart, send OpenAI-shaped stream errors"
```

Body: the three reasons from §1.2 and §1.6, one paragraph each. Then, once
asked: `bun run build:engine` so Task 3 has a binary with the `acp`
subcommand and this shutdown path. Say so before running it.

---

## Task 1: The repository, the base, the submodule

**Files:**
- Create: `KnightCodeAI/knightcode-ide` (GitHub), `README.md` in it
- Create: `.gitmodules`, `apps/desktop/ide` (this repository)
- Modify: `apps/desktop/docs/architecture.md` (§1.10)

**Interfaces:**
- Produces: a fork repository whose `main` is upstream commit
  `a57ba9b17c433ea1ebfdec8f649f4fa5a402d03b` plus one commit (README),
  tagged `knightcode-base`; remote `upstream` =
  `https://github.com/zed-industries/zed`; the submodule in this
  repository pointing at it.

Decisions to confirm before running Step 1 (see the questions at the end
of this plan): repository visibility; whether the owner creates the
repository or `gh repo create` does.

- [x] **Step 1: Create the fork**

```bash
gh repo create KnightCodeAI/knightcode-ide --private --description "KnightCode IDE: a Zed fork with KnightCode as its only agent, inference path and login" --disable-wiki
cd <somewhere outside this checkout>
git clone https://github.com/zed-industries/zed knightcode-ide
cd knightcode-ide
git checkout -b main a57ba9b17c433ea1ebfdec8f649f4fa5a402d03b
git remote rename origin upstream
git remote add origin https://github.com/KnightCodeAI/knightcode-ide.git
git tag knightcode-base
```

Confirm the checkout is the read-only tree: with the fork checked out at
`knightcode-base`, `git diff --no-index -- crates/agent_servers/src/acp.rs
<read-only>/crates/agent_servers/src/acp.rs` prints nothing, and the same
for `crates/zed/src/main.rs` and `Cargo.lock`. The read-only tree is not
used again after this; every later line reference is checked
against the fork.

- [x] **Step 2: Write the fork's README**

`README.md` replaces Zed's. Sections: what this is (three paragraphs from
the architecture: the product, the engine, the seams); the base commit,
its date, the nearest upstream tags (`v1.19.2` stable, `v1.20.0-pre`) and
the `knightcode-base` tag; the merge procedure (`git fetch upstream`,
`git merge upstream/v1.21.0` when cut, conflicts expected only in the
files listed in the fork-surface table, which the README repeats); how
to build (`cargo build -p zed`, the Windows prerequisites Zed documents in
`docs/src/development/windows.md`); how to point a development build at
an engine binary (`knightcode.engine_path`, `KNIGHTCODE_ENGINE_PATH`);
licence (GPL-3.0-or-later, as Zed's `LICENSE-GPL`; the engine is a
separate MIT program). No mention of tooling or reference trees.

```bash
git add README.md
git commit -m "docs: describe the fork, its base and its merge procedure"
git push -u origin main
git push origin knightcode-base
```

- [x] **Step 3: First build**

```bash
cargo build -p zed
```

Expected: a clean build. On this machine the first build is long (Zed is
about 1,500 crates) and the target directory is tens of gigabytes; say so
before starting it, and run it in the background. If it fails on a
Windows prerequisite, follow `docs/src/development/windows.md` in the fork
and record what was missing in Implementation notes; do not patch the
build to get past it.

- [x] **Step 4: Add the submodule here**

```bash
git submodule add https://github.com/KnightCodeAI/knightcode-ide.git apps/desktop/ide
```

Confirm `bun run check-types` is unaffected (the root `tsconfig.json`
globs `packages/*`; `.prettierignore` covers `apps/`), and that
`git status` shows only `.gitmodules` and `apps/desktop/ide`.

- [x] **Step 5: Amend architecture.md**

The edits in §1.10, each one line or one table row. Update the Status
line to "Phases A and B implemented; Phase C in progress".

- [x] **Step 6: Commit**

```bash
git add .gitmodules apps/desktop/ide apps/desktop/docs/architecture.md
git commit -m "chore(desktop): add the IDE fork as a submodule"
```

---

## Task 2: `knightcode_engine` — settings, environment, process

**Files (fork):**
- Create: `crates/knightcode_engine/Cargo.toml`,
  `src/knightcode_engine.rs`, `src/settings.rs`, `src/environment.rs`,
  `src/process.rs`
- Modify: `Cargo.toml` (one member, one workspace dependency),
  `crates/settings_content/src/settings_content.rs` (the section)

**Interfaces:**
- Consumes: `settings::{Settings, SettingsContent}`, `http_client::
  HttpClient`, `util::process::Child`, `util::command::new_std_command`,
  `smol`, `thiserror`.
- Produces:
  - `settings_content::KnightCodeSettingsContent { engine_path: Option<String>, engine_url: Option<String>, edit_prediction_model: Option<String> }`
    and `SettingsContent.knightcode: Option<KnightCodeSettingsContent>`.
  - `pub struct EngineSettings { pub engine_path: Option<PathBuf>, pub engine_url: Option<String>, pub edit_prediction_model: Option<String> }`
    with `impl Settings`.
  - `environment.rs`:
    `pub const TOKEN_ENV: &str = "KNIGHTCODE_ENGINE_TOKEN"`,
    `pub const PORT_ENV: &str = "KNIGHTCODE_ENGINE_PORT"`,
    `pub const PATH_ENV: &str = "KNIGHTCODE_ENGINE_PATH"`,
    `pub const BINARY_NAME: &str`,
    `pub fn loopback_no_proxy(existing: Option<&str>) -> String`,
    `pub fn ensure_loopback_no_proxy()`,
    `pub fn generate_token() -> String` (48 hex characters),
    `pub fn engine_environment(token: &str, port: Option<u16>, proxy: &[(String, String)]) -> (Vec<(String, String)>, Vec<&'static str>)`,
    `pub fn locate_binary(setting: Option<&Path>, env: Option<&Path>, exe_dir: Option<&Path>) -> Result<PathBuf>`.
  - `process.rs`:
    `pub const STALL_TIMEOUT: Duration = 60 s`, `pub const STOP_TIMEOUT: Duration = 6 s`,
    `pub struct EngineCommand { pub program: PathBuf, pub args: Vec<String>, pub set: Vec<(String, String)>, pub remove: Vec<&'static str> }`,
    `pub enum StartError { Spawn { path, source }, ExitedBeforeReady { status, stderr }, Stalled { timeout, stderr }, TokenRejected { status }, Io(anyhow::Error) }`,
    `pub fn parse_port_line(line: &str) -> Option<u16>`,
    `pub async fn start(command: EngineCommand, token: &str, http: Arc<dyn HttpClient>, stall_timeout: Duration) -> Result<EngineProcess, StartError>`,
    `pub struct EngineProcess { pub port: u16, .. }` with
    `pub fn exit(&self) -> Shared<BoxFuture<'static, ExitOutcome>>`,
    `pub fn release(&mut self)`, `pub fn kill(&mut self)`,
    `pub async fn stop(self) -> ExitOutcome`;
    `#[derive(Clone)] pub struct ExitOutcome { pub status: Option<ExitStatus>, pub stderr: String }`.

`process.rs` is written against `smol` and `futures` only — no gpui — so
its tests are plain `#[test]`s under `smol::block_on`, and the timers are
real: a stalled engine must be detected while the test is parked on real
pipe I/O, which gpui's simulated clock would not advance. The test binary
doubles as the fake engine (Step 1), spawned by path, exactly as the real
one will be.

- [x] **Step 1: Write the failing tests**

`crates/knightcode_engine/src/environment.rs` ends with:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_is_added_once_and_case_insensitively() {
        assert_eq!(loopback_no_proxy(None), "127.0.0.1,localhost,::1");
        assert_eq!(
            loopback_no_proxy(Some("corp.example, LOCALHOST ,")),
            "corp.example,LOCALHOST,127.0.0.1,::1"
        );
    }

    #[test]
    fn the_engine_environment_carries_the_token_and_drops_debug() {
        let (set, remove) = engine_environment("t", Some(4321), &[("HTTP_PROXY".into(), "http://p".into())]);
        assert!(set.contains(&(TOKEN_ENV.to_string(), "t".to_string())));
        assert!(set.contains(&(PORT_ENV.to_string(), "4321".to_string())));
        assert!(set.contains(&("HTTP_PROXY".to_string(), "http://p".to_string())));
        assert!(set.iter().any(|(key, value)| key == "NO_PROXY" && value.contains("127.0.0.1")));
        assert!(remove.contains(&"DEBUG"));
        assert_eq!(remove.contains(&"LD_PRELOAD"), cfg!(target_os = "linux"));
        let (set, _) = engine_environment("t", None, &[]);
        assert!(!set.iter().any(|(key, _)| key == PORT_ENV));
    }

    #[test]
    fn a_token_is_48_hex_characters_and_fresh_each_time() {
        let token = generate_token();
        assert_eq!(token.len(), 48);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(token, generate_token());
    }

    #[test]
    fn the_binary_is_found_by_setting_then_env_then_sibling_and_absence_names_the_path() {
        let dir = tempfile::tempdir().unwrap();
        let present = dir.path().join(BINARY_NAME);
        std::fs::write(&present, b"").unwrap();
        let missing = dir.path().join("nope").join(BINARY_NAME);

        assert_eq!(locate_binary(Some(&present), Some(&missing), None).unwrap(), present);
        assert_eq!(locate_binary(None, Some(&present), None).unwrap(), present);
        assert_eq!(locate_binary(None, None, Some(dir.path())).unwrap(), present);
        let error = locate_binary(Some(&missing), None, None).unwrap_err().to_string();
        assert!(error.contains(&missing.display().to_string()), "{error}");
        assert!(error.contains("knightcode.engine_path"), "{error}");
        assert!(locate_binary(None, None, None).unwrap_err().to_string().contains(PATH_ENV));
    }
}
```

`crates/knightcode_engine/src/process.rs` ends with:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::environment::{PORT_ENV, TOKEN_ENV, engine_environment};
    use http_client::{FakeHttpClient, Response};

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef";

    /// The test binary is the fake engine. Spawned with `KNIGHTCODE_FAKE_ENGINE`
    /// set, this "test" behaves like an engine in the named mode and never
    /// returns to the harness. The harness's own lines on stdout ("running 1
    /// test") are what a real engine's stray output looks like, and the port
    /// reader must skip them.
    #[test]
    fn fake_engine() {
        let Ok(mode) = std::env::var("KNIGHTCODE_FAKE_ENGINE") else {
            return;
        };
        match mode.as_str() {
            "listening" => {
                let port = std::env::var(PORT_ENV).unwrap_or_else(|_| "4321".into());
                println!("{{\"type\":\"listening\",\"port\":{port}}}");
                // Like the real engine after Task 0: exit when stdin closes.
                let _ = std::io::stdin().read_line(&mut String::new());
                std::process::exit(0);
            }
            "exit" => {
                eprintln!("boom: the fake engine refuses to start");
                std::process::exit(3);
            }
            "silent" => std::thread::sleep(Duration::from_secs(120)),
            other => panic!("unknown fake engine mode {other}"),
        }
    }

    fn fake_command(mode: &str, port: Option<u16>) -> EngineCommand {
        let (set, remove) = engine_environment(TOKEN, port, &[]);
        let mut set = set;
        set.push(("KNIGHTCODE_FAKE_ENGINE".into(), mode.into()));
        EngineCommand {
            program: std::env::current_exe().unwrap(),
            args: ["--exact", "process::tests::fake_engine", "--nocapture", "--test-threads=1"]
                .map(String::from)
                .to_vec(),
            set,
            remove,
        }
    }

    /// A fake engine on the wire: /health is open, /v1/accounts checks the bearer.
    fn fake_http(accept_token: bool) -> Arc<dyn HttpClient> {
        FakeHttpClient::create(move |request| async move {
            let status = match request.uri().path() {
                "/health" => 200,
                "/v1/accounts" => {
                    let bearer = request
                        .headers()
                        .get("authorization")
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or("");
                    if accept_token && bearer == format!("Bearer {TOKEN}") { 200 } else { 401 }
                }
                _ => 404,
            };
            Ok(Response::builder().status(status).body(AsyncBody::from("{}")).unwrap())
        })
    }

    #[test]
    fn a_port_line_is_recognised_among_other_output() {
        assert_eq!(parse_port_line(r#"{"type":"listening","port":54376}"#), Some(54376));
        assert_eq!(parse_port_line("running 1 test"), None);
        assert_eq!(parse_port_line(r#"{"type":"other","port":1}"#), None);
        assert_eq!(parse_port_line(r#"{"type":"listening","port":"x"}"#), None);
        assert_eq!(parse_port_line(""), None);
    }

    #[test]
    fn a_missing_binary_is_reported_by_path() {
        let path = std::env::temp_dir().join("knightcode-engine-that-does-not-exist");
        let command = EngineCommand { program: path.clone(), args: vec![], set: vec![], remove: vec![] };
        let error = smol::block_on(start(command, TOKEN, fake_http(true), STALL_TIMEOUT)).unwrap_err();
        assert!(matches!(error, StartError::Spawn { .. }));
        assert!(error.to_string().contains(&path.display().to_string()), "{error}");
    }

    #[test]
    fn an_exit_before_ready_carries_the_status_and_stderr() {
        let error = smol::block_on(start(fake_command("exit", None), TOKEN, fake_http(true), STALL_TIMEOUT)).unwrap_err();
        let StartError::ExitedBeforeReady { status, stderr } = &error else {
            panic!("{error}");
        };
        assert_eq!(status.code(), Some(3));
        assert!(stderr.contains("boom"), "{stderr}");
        assert!(error.to_string().contains("boom"), "{error}");
    }

    #[test]
    fn a_silent_engine_stalls_and_is_killed() {
        let started = std::time::Instant::now();
        let error = smol::block_on(start(fake_command("silent", None), TOKEN, fake_http(true), Duration::from_millis(500))).unwrap_err();
        assert!(matches!(error, StartError::Stalled { .. }), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn a_rejected_token_is_its_own_error() {
        let error = smol::block_on(start(fake_command("listening", None), TOKEN, fake_http(false), STALL_TIMEOUT)).unwrap_err();
        assert!(matches!(error, StartError::TokenRejected { status: 401 }), "{error}");
    }

    #[test]
    fn ready_after_three_phases_and_stopped_by_stdin() {
        smol::block_on(async {
            let process = start(fake_command("listening", Some(4545)), TOKEN, fake_http(true), STALL_TIMEOUT).await.unwrap();
            assert_eq!(process.port, 4545);
            let started = std::time::Instant::now();
            let outcome = process.stop().await;
            assert_eq!(outcome.status.and_then(|status| status.code()), Some(0));
            // The engine exited on EOF; the kill deadline was never reached.
            assert!(started.elapsed() < STOP_TIMEOUT);
        });
    }
}
```

`tempfile` is a workspace dependency already; add it under
`[dev-dependencies]`.

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p knightcode_engine`
Expected: the crate does not exist yet. After Step 3's manifests and empty
modules, the tests fail to compile on the missing items.

- [x] **Step 3: Write minimal implementation**

Root `Cargo.toml`: `"crates/knightcode_engine",` in `members` (sorted),
`knightcode_engine = { path = "crates/knightcode_engine" }` in
`[workspace.dependencies]` (sorted).

```toml
# crates/knightcode_engine/Cargo.toml
[package]
name = "knightcode_engine"
version = "0.1.0"
edition.workspace = true
publish = false
license = "GPL-3.0-or-later"

[lints]
workspace = true

[lib]
path = "src/knightcode_engine.rs"

[dependencies]
anyhow.workspace = true
collections.workspace = true
futures.workspace = true
gpui.workspace = true
http_client.workspace = true
log.workspace = true
rand.workspace = true
serde.workspace = true
serde_json.workspace = true
settings.workspace = true
smol.workspace = true
thiserror.workspace = true
util.workspace = true

[dev-dependencies]
gpui = { workspace = true, features = ["test-support"] }
http_client = { workspace = true, features = ["test-support"] }
settings = { workspace = true, features = ["test-support"] }
tempfile.workspace = true
```

`crates/settings_content/src/settings_content.rs`, after
`AudioSettingsContent`:

```rust
/// KnightCode's engine and the surfaces it serves.
#[with_fallible_options]
#[derive(Clone, PartialEq, Default, Serialize, Deserialize, JsonSchema, MergeFrom, Debug)]
pub struct KnightCodeSettingsContent {
    /// Absolute path of the `knightcode-engine` binary.
    ///
    /// Default: `KNIGHTCODE_ENGINE_PATH`, then `knightcode-engine` next to the IDE executable.
    pub engine_path: Option<String>,
    /// Attach to an engine already running at this URL instead of starting one.
    /// `KNIGHTCODE_ENGINE_TOKEN` must then be set in the IDE's environment.
    ///
    /// Default: none
    pub engine_url: Option<String>,
    /// The model edit prediction sends to, as a `<providerId>/<modelId>` reference from the engine's catalog.
    ///
    /// Default: the default model
    pub edit_prediction_model: Option<String>,
}
```

and in `SettingsContent`, next to `audio`:

```rust
    pub knightcode: Option<KnightCodeSettingsContent>,
```

```rust
// crates/knightcode_engine/src/settings.rs
//! The `knightcode` settings section, resolved.

use settings::{Settings, SettingsContent};
use std::path::PathBuf;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct EngineSettings {
    pub engine_path: Option<PathBuf>,
    pub engine_url: Option<String>,
    pub edit_prediction_model: Option<String>,
}

fn non_empty(value: Option<&String>) -> Option<String> {
    value.map(|value| value.trim()).filter(|value| !value.is_empty()).map(str::to_owned)
}

impl Settings for EngineSettings {
    fn from_settings(content: &SettingsContent) -> Self {
        let section = content.knightcode.as_ref();
        Self {
            engine_path: non_empty(section.and_then(|section| section.engine_path.as_ref())).map(PathBuf::from),
            engine_url: non_empty(section.and_then(|section| section.engine_url.as_ref())),
            edit_prediction_model: non_empty(section.and_then(|section| section.edit_prediction_model.as_ref())),
        }
    }
}
```

```rust
// crates/knightcode_engine/src/environment.rs
//! What the engine process receives, and where its binary is. Pure, so the
//! lifecycle's decisions are testable without a process.

use anyhow::{Result, anyhow};
use rand::RngCore as _;
use std::path::{Path, PathBuf};

pub const TOKEN_ENV: &str = "KNIGHTCODE_ENGINE_TOKEN";
pub const PORT_ENV: &str = "KNIGHTCODE_ENGINE_PORT";
pub const PATH_ENV: &str = "KNIGHTCODE_ENGINE_PATH";
pub const BINARY_NAME: &str = if cfg!(windows) { "knightcode-engine.exe" } else { "knightcode-engine" };

const LOOPBACK: [&str; 3] = ["127.0.0.1", "localhost", "::1"];

/// `existing` with the loopback hosts present exactly once. A corporate
/// `HTTP_PROXY` otherwise swallows the IDE's own traffic to the engine.
pub fn loopback_no_proxy(existing: Option<&str>) -> String {
    let mut entries: Vec<String> = existing
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(str::to_owned)
        .collect();
    for host in LOOPBACK {
        if !entries.iter().any(|entry| entry.eq_ignore_ascii_case(host)) {
            entries.push(host.to_owned());
        }
    }
    entries.join(",")
}

/// Fixes the IDE's own process environment. Runs in `main` before the HTTP
/// client is built, because that client reads `NO_PROXY` once, at
/// construction; every child process inherits the result.
pub fn ensure_loopback_no_proxy() {
    for key in ["NO_PROXY", "no_proxy"] {
        let value = loopback_no_proxy(std::env::var(key).ok().as_deref());
        // SAFETY: called from `main` before any other thread reads the environment.
        unsafe { std::env::set_var(key, value) };
    }
}

/// 24 random bytes as hex: 48 characters, above the engine's 32 minimum.
pub fn generate_token() -> String {
    let mut bytes = [0u8; 24];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Variables set on top of the inherited environment, and variables removed
/// from it. `proxy` is what Zed's settings say (`agent_servers::load_proxy_env`).
pub fn engine_environment(
    token: &str,
    port: Option<u16>,
    proxy: &[(String, String)],
) -> (Vec<(String, String)>, Vec<&'static str>) {
    let no_proxy = loopback_no_proxy(std::env::var("NO_PROXY").ok().as_deref());
    let mut set = vec![
        (TOKEN_ENV.to_owned(), token.to_owned()),
        ("NO_PROXY".to_owned(), no_proxy.clone()),
        ("no_proxy".to_owned(), no_proxy),
    ];
    if let Some(port) = port {
        set.push((PORT_ENV.to_owned(), port.to_string()));
    }
    set.extend(proxy.iter().cloned());
    // DEBUG turns on library tracing in Node-style runtimes and floods stderr;
    // LD_PRELOAD is whatever the desktop session injected, which a Bun binary
    // does not want.
    let mut remove = vec!["DEBUG"];
    if cfg!(target_os = "linux") {
        remove.push("LD_PRELOAD");
    }
    (set, remove)
}

/// The setting, then the environment variable, then the binary beside the
/// IDE executable. The error names the path that was tried.
pub fn locate_binary(setting: Option<&Path>, env: Option<&Path>, exe_dir: Option<&Path>) -> Result<PathBuf> {
    let candidate = setting
        .map(Path::to_path_buf)
        .or_else(|| env.map(Path::to_path_buf))
        .or_else(|| exe_dir.map(|dir| dir.join(BINARY_NAME)));
    let Some(candidate) = candidate else {
        return Err(anyhow!(
            "knightcode-engine was not found: set knightcode.engine_path or {PATH_ENV}, or place {BINARY_NAME} next to the IDE executable"
        ));
    };
    if candidate.is_file() {
        Ok(candidate)
    } else {
        Err(anyhow!(
            "knightcode-engine was not found at {}: set knightcode.engine_path to the binary, or build one with `bun run build:engine`",
            candidate.display()
        ))
    }
}
```

```rust
// crates/knightcode_engine/src/process.rs
//! The engine process: spawn, three-phase readiness, stop.
//!
//! Readiness is the port line on stdout, then `/health`, then one
//! authenticated request, every phase raced against the process exiting and
//! against one stall timer. The token check is the phase that matters most:
//! the adapter turns every 401 into a sign-in prompt, so a token the engine
//! does not accept must fail here, where it can be named. This module is
//! written against smol alone so it can be tested by spawning a real process
//! from a plain test.

use anyhow::{Result, anyhow};
use futures::{
    AsyncBufReadExt as _, FutureExt as _, StreamExt as _,
    channel::oneshot,
    future::{self, BoxFuture, Either, Shared},
    io::BufReader,
};
use http_client::{AsyncBody, HttpClient, Method, Request};
use smol::process::ChildStdin;
use std::{
    collections::VecDeque,
    path::PathBuf,
    pin::pin,
    process::{ExitStatus, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use util::{ResultExt as _, process::Child};

pub const STALL_TIMEOUT: Duration = Duration::from_secs(60);
pub const STOP_TIMEOUT: Duration = Duration::from_secs(6);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const EXIT_GRACE: Duration = Duration::from_millis(250);
const STDERR_TAIL_LINES: usize = 40;

pub struct EngineCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub set: Vec<(String, String)>,
    pub remove: Vec<&'static str>,
}

#[derive(Debug, thiserror::Error)]
pub enum StartError {
    #[error("could not start knightcode-engine at {path}: {source:#}")]
    Spawn {
        path: PathBuf,
        #[source]
        source: anyhow::Error,
    },
    #[error("knightcode-engine exited before it was ready ({status}){}", tail(stderr))]
    ExitedBeforeReady { status: ExitStatus, stderr: String },
    #[error("knightcode-engine did not become ready within {timeout:?}{}", tail(stderr))]
    Stalled { timeout: Duration, stderr: String },
    #[error("knightcode-engine rejected the launch token (HTTP {status}); the binary is not the one this IDE was built with")]
    TokenRejected { status: u16 },
    #[error("knightcode-engine: {0:#}")]
    Io(anyhow::Error),
}

fn tail(stderr: &str) -> String {
    if stderr.trim().is_empty() {
        String::new()
    } else {
        format!(":\n{}", stderr.trim_end())
    }
}

/// The last lines the engine wrote to stderr, kept for error messages.
#[derive(Clone, Default)]
struct StderrTail(Arc<Mutex<VecDeque<String>>>);

impl StderrTail {
    fn push(&self, line: String) {
        let mut lines = self.0.lock().unwrap();
        if lines.len() == STDERR_TAIL_LINES {
            lines.pop_front();
        }
        lines.push_back(line);
    }

    fn snapshot(&self) -> String {
        self.0.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n")
    }
}

#[derive(Clone, Debug)]
pub struct ExitOutcome {
    /// `None` when the wait itself failed.
    pub status: Option<ExitStatus>,
    pub stderr: String,
}

pub struct EngineProcess {
    pub port: u16,
    stdin: Option<ChildStdin>,
    kill: Option<oneshot::Sender<()>>,
    exit: Shared<BoxFuture<'static, ExitOutcome>>,
}

/// `{"type":"listening","port":N}`; anything else is not a port line.
pub fn parse_port_line(line: &str) -> Option<u16> {
    let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    if value.get("type")?.as_str()? != "listening" {
        return None;
    }
    u16::try_from(value.get("port")?.as_u64()?).ok()
}

enum Phase {
    Ready(Result<u16, StartError>),
    Exited(std::io::Result<ExitStatus>),
    Stalled,
}

pub async fn start(
    command: EngineCommand,
    token: &str,
    http: Arc<dyn HttpClient>,
    stall_timeout: Duration,
) -> Result<EngineProcess, StartError> {
    let mut std_command = util::command::new_std_command(&command.program);
    std_command.args(&command.args);
    for (key, value) in &command.set {
        std_command.env(key, value);
    }
    for key in &command.remove {
        std_command.env_remove(key);
    }
    let mut child = Child::spawn(std_command, Stdio::piped(), Stdio::piped(), Stdio::piped())
        .map_err(|source| StartError::Spawn { path: command.program.clone(), source })?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr_pipe = child.stderr.take().expect("stderr is piped");

    // Drained for the life of the process: a full pipe would block the engine.
    let stderr = StderrTail::default();
    smol::spawn({
        let stderr = stderr.clone();
        async move {
            let mut lines = BufReader::new(stderr_pipe).lines();
            while let Some(Ok(line)) = lines.next().await {
                log::warn!("knightcode-engine: {line}");
                stderr.push(line);
            }
        }
    })
    .detach();

    let ready = async {
        let mut lines = BufReader::new(stdout).lines();
        let port = loop {
            match lines.next().await {
                Some(Ok(line)) => match parse_port_line(&line) {
                    Some(port) => break port,
                    None => log::info!("knightcode-engine: {line}"),
                },
                Some(Err(error)) => return Err(StartError::Io(error.into())),
                None => return Err(StartError::Io(anyhow!("stdout closed before the listening line"))),
            }
        };
        smol::spawn(async move { while let Some(Ok(_)) = lines.next().await {} }).detach();

        let url = format!("http://127.0.0.1:{port}");
        loop {
            if let Ok(response) = http.get(&format!("{url}/health"), AsyncBody::empty(), false).await
                && response.status().is_success()
            {
                break;
            }
            smol::Timer::after(POLL_INTERVAL).await;
        }

        let request = Request::builder()
            .method(Method::GET)
            .uri(format!("{url}/v1/accounts"))
            .header("Authorization", format!("Bearer {token}"))
            .body(AsyncBody::empty())
            .map_err(|error| StartError::Io(error.into()))?;
        let response = http.send(request).await.map_err(StartError::Io)?;
        if response.status().as_u16() == 401 {
            return Err(StartError::TokenRejected { status: 401 });
        }
        Ok(port)
    };

    let phase = {
        let ready = pin!(ready);
        let exited = pin!(child.status());
        let deadline = pin!(smol::Timer::after(stall_timeout));
        match future::select(future::select(ready, exited), deadline).await {
            Either::Left((Either::Left((result, _)), _)) => Phase::Ready(result),
            Either::Left((Either::Right((status, _)), _)) => Phase::Exited(status),
            Either::Right(_) => Phase::Stalled,
        }
    };

    let port = match phase {
        Phase::Ready(Ok(port)) => port,
        Phase::Ready(Err(error)) => {
            // The engine may have exited between its last line and our read;
            // its status and stderr are the better report.
            let exited = {
                let status = pin!(child.status());
                let grace = pin!(smol::Timer::after(EXIT_GRACE));
                match future::select(status, grace).await {
                    Either::Left((Ok(status), _)) => Some(status),
                    _ => None,
                }
            };
            return Err(match exited {
                Some(status) => StartError::ExitedBeforeReady { status, stderr: stderr.snapshot() },
                None => {
                    child.kill().log_err();
                    error
                }
            });
        }
        Phase::Exited(status) => {
            let status = status.map_err(|error| StartError::Io(error.into()))?;
            return Err(StartError::ExitedBeforeReady { status, stderr: stderr.snapshot() });
        }
        Phase::Stalled => {
            child.kill().log_err();
            return Err(StartError::Stalled { timeout: stall_timeout, stderr: stderr.snapshot() });
        }
    };

    // From here the child lives inside the exit future: whoever awaits it
    // observes the exit, and a kill request is honoured by the same future.
    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    let exit = {
        let stderr = stderr.clone();
        async move {
            let mut child = child;
            let exited = {
                let status = pin!(child.status());
                match future::select(status, kill_rx).await {
                    Either::Left((status, _)) => Some(status),
                    Either::Right(_) => None,
                }
            };
            let status = match exited {
                Some(status) => status,
                None => {
                    child.kill().log_err();
                    child.status().await
                }
            };
            ExitOutcome { status: status.ok(), stderr: stderr.snapshot() }
        }
        .boxed()
        .shared()
    };

    Ok(EngineProcess { port, stdin, kill: Some(kill_tx), exit })
}

impl EngineProcess {
    /// Resolves when the process has exited. Clone-able; every holder sees
    /// the same outcome.
    pub fn exit(&self) -> Shared<BoxFuture<'static, ExitOutcome>> {
        self.exit.clone()
    }

    /// Close stdin. The engine shuts itself down on EOF (Task 0); this is
    /// all a quit can afford inside gpui's 200 ms.
    pub fn release(&mut self) {
        self.stdin.take();
    }

    pub fn kill(&mut self) {
        if let Some(kill) = self.kill.take() {
            kill.send(()).ok();
        }
    }

    /// Release, wait up to `STOP_TIMEOUT`, then kill.
    pub async fn stop(mut self) -> ExitOutcome {
        self.release();
        let exit = self.exit();
        let outcome = {
            let exit = pin!(exit);
            let deadline = pin!(smol::Timer::after(STOP_TIMEOUT));
            match future::select(exit, deadline).await {
                Either::Left((outcome, _)) => Some(outcome),
                Either::Right(_) => None,
            }
        };
        match outcome {
            Some(outcome) => outcome,
            None => {
                log::warn!("knightcode-engine did not exit within {STOP_TIMEOUT:?}; killing it");
                self.kill();
                self.exit().await
            }
        }
    }
}
```

```rust
// crates/knightcode_engine/src/knightcode_engine.rs
//! The engine as the IDE sees it: one process per application, spawned with
//! a generated token, watched, restarted, and reached over loopback HTTP.
//! Nothing here holds a credential; the launch token is the only secret.

pub mod environment;
pub mod process;
pub mod settings;

pub use settings::EngineSettings;
```

(`client.rs`, `login.rs` and `engine.rs` are Task 3.)

- [x] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p knightcode_engine`
Expected: PASS, 10 tests plus `fake_engine` (which returns at once when
the variable is unset). `a_silent_engine_stalls_and_is_killed` takes about
half a second; the rest are fast. If `an_exit_before_ready_carries_the_
status_and_stderr` sees the stdout-closed `Io` path instead of
`ExitedBeforeReady`, the grace wait is too short for the harness's exit;
raise `EXIT_GRACE` to 1 s and record it.

Then `cargo build -p settings_content -p settings` for the section, and
`cargo test -p settings_content` to confirm the schema derive is happy.

- [x] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock crates/knightcode_engine crates/settings_content/src/settings_content.rs
git commit -m "feat(knightcode_engine): spawn the engine and prove it ready"
```

---

## Task 3: `knightcode_engine` — client, login, the `Engine` entity

**Files (fork):**
- Create: `crates/knightcode_engine/src/client.rs`, `src/login.rs`,
  `src/engine.rs`
- Modify: `crates/knightcode_engine/src/knightcode_engine.rs`

**Interfaces:**
- Consumes: Task 2; `gpui::{App, Context, Entity, EventEmitter, Global, Task}`,
  `settings::SettingsStore`, `agent_servers::load_proxy_env` is *not*
  consumed here (it needs `agent_servers`; the engine crate takes the proxy
  pairs as an argument and `main.rs` supplies them).
- Produces:
  - `client.rs`:
    `#[derive(Clone)] pub struct Endpoint { pub url: String, pub token: Arc<str> }`,
    `#[derive(Clone)] pub struct EngineClient { .. }` with
    `pub fn new(http: Arc<dyn HttpClient>, endpoint: Endpoint) -> Self`,
    `pub fn endpoint(&self) -> &Endpoint`,
    `pub async fn accounts(&self) -> Result<Accounts, ClientError>`,
    `pub async fn models(&self) -> Result<Vec<EngineModel>, ClientError>`,
    `pub async fn start_login(&self, provider_id: &str, kind: LoginKind) -> Result<String, ClientError>`,
    `pub async fn login_state(&self, login_id: &str) -> Result<LoginState, ClientError>`,
    `pub async fn submit_login(&self, login_id: &str, value: &str) -> Result<(), ClientError>`,
    `pub async fn cancel_login(&self, login_id: &str) -> Result<(), ClientError>`,
    `pub async fn sign_out(&self, provider_id: &str) -> Result<(), ClientError>`,
    `pub async fn completion(&self, model: &str, prefix: &str, suffix: &str, max_tokens: u32) -> Result<String, ClientError>`,
    `pub async fn events(&self, on_event: impl FnMut(EngineEvent)) -> Result<(), ClientError>`;
    the data types `Account`, `LoginOption`, `LoginKind`, `Accounts`,
    `EngineModel`, `LoginState`, `LoginEvent`, `PendingPrompt`,
    `LoginPrompt`, `PromptKind`, `EngineEvent`, and
    `pub enum ClientError { Status { status: u16, code: String, message: String }, Transport(anyhow::Error) }`.
  - `login.rs`: `pub struct Login { .. }` with
    `pub async fn start(client: EngineClient, provider_id: &str, kind: LoginKind) -> Result<Login, ClientError>`,
    `pub async fn advance(&mut self, on_event: impl FnMut(&LoginEvent)) -> Result<LoginOutcome, LoginError>`,
    `pub async fn submit(&self, value: &str) -> Result<(), ClientError>`,
    `pub async fn cancel(&self) -> Result<(), ClientError>`;
    `pub enum LoginOutcome { Complete, Prompt(PendingPrompt) }`;
    `pub enum LoginError { Failed(String), Client(ClientError) }`.
  - `engine.rs`: `pub enum EngineStatus { Starting, Ready(Endpoint), Failed(SharedString) }`,
    `pub enum EngineEvent { Ready(Endpoint), Failed(SharedString), Stopped, AccountChanged { provider_id: String, authenticated: bool }, ModelsChanged }`,
    `pub struct Engine { .. }` with `impl EventEmitter<EngineEvent>`,
    `pub fn init(proxy: Vec<(String, String)>, shell_env_loaded: Option<oneshot::Receiver<()>>, cx: &mut App) -> Entity<Engine>`,
    `pub fn global(cx: &App) -> Entity<Engine>`,
    `pub fn try_global(cx: &App) -> Option<Entity<Engine>>`,
    `pub fn status(&self) -> &EngineStatus`, `pub fn endpoint(&self) -> Option<Endpoint>`,
    `pub fn client(&self) -> Option<EngineClient>`, `pub fn binary(&self) -> Option<&Path>`,
    `pub fn ready(&mut self, cx: &mut Context<Self>) -> Task<Result<Endpoint>>`,
    `pub fn restart(&mut self, cx: &mut Context<Self>)`,
    `pub fn release(&mut self)`;
    `pub fn restart_delay(exits: &VecDeque<Instant>, now: Instant) -> Option<Duration>` (pure);
    test-support: `pub fn failed_for_tests(message: &str, cx: &mut App) -> Entity<Engine>`,
    `pub fn ready_for_tests(endpoint: Endpoint, http: Arc<dyn HttpClient>, cx: &mut App) -> Entity<Engine>`.

The client is plain async over `Arc<dyn HttpClient>` so it is testable
with `FakeHttpClient` under `smol::block_on`; only `engine.rs` touches
gpui. `EngineClient` deliberately has no chat-completions method: seam 2
uses `open_ai::stream_completion` directly (§1.6).

- [x] **Step 1: Write the failing tests**

`client.rs` tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use http_client::{FakeHttpClient, Response};
    use std::sync::Mutex;

    fn client(handler: impl Fn(&str, &str, String) -> (u16, String) + Send + Sync + 'static) -> EngineClient {
        let handler = Arc::new(handler);
        let http = FakeHttpClient::create(move |mut request| {
            let method = request.method().to_string();
            let path = request.uri().path().to_string();
            let handler = handler.clone();
            async move {
                let mut body = String::new();
                futures::AsyncReadExt::read_to_string(request.body_mut(), &mut body).await.ok();
                let (status, body) = handler(&method, &path, body);
                Ok(Response::builder().status(status).body(AsyncBody::from(body)).unwrap())
            }
        });
        EngineClient::new(http, Endpoint { url: "http://127.0.0.1:1".into(), token: "t".into() })
    }

    #[test]
    fn accounts_and_models_parse_and_carry_no_secret_fields() {
        let client = client(|_, path, _| match path {
            "/v1/accounts" => (200, r#"{"accounts":[{"providerId":"anthropic","providerName":"Anthropic","type":"oauth","isSubscription":true}],"loginOptions":[{"providerId":"anthropic","providerName":"Anthropic","type":"oauth","label":"Anthropic (Claude Pro/Max)","isSubscription":true},{"providerId":"openai","providerName":"OpenAI","type":"api_key","label":"OpenAI API key","isSubscription":false}]}"#.into()),
            "/v1/models" => (200, r#"{"models":[{"ref":"anthropic/claude-opus-5","id":"claude-opus-5","providerId":"anthropic","providerName":"Anthropic","name":"Claude Opus 5","contextWindow":200000,"maxTokens":32000,"reasoning":true,"input":["text","image"],"cost":{"input":1,"output":2}}]}"#.into()),
            _ => (404, "{}".into()),
        });
        let accounts = smol::block_on(client.accounts()).unwrap();
        assert_eq!(accounts.accounts[0].provider_id, "anthropic");
        assert_eq!(accounts.accounts[0].kind, LoginKind::Oauth);
        assert_eq!(accounts.login_options.len(), 2);
        assert_eq!(accounts.login_options[1].kind, LoginKind::ApiKey);
        let models = smol::block_on(client.models()).unwrap();
        assert_eq!(models[0].reference, "anthropic/claude-opus-5");
        assert_eq!(models[0].context_window, 200_000);
        assert!(models[0].reasoning);
    }

    #[test]
    fn a_status_error_carries_the_engine_code_and_the_bearer_is_sent() {
        let client = client(|_, _, _| (401, r#"{"error":"unauthorized"}"#.into()));
        let error = smol::block_on(client.models()).unwrap_err();
        assert!(matches!(&error, ClientError::Status { status: 401, code, .. } if code == "unauthorized"), "{error}");
    }

    #[test]
    fn login_calls_use_the_documented_routes_and_bodies() {
        let seen = Arc::new(Mutex::new(Vec::<String>::new()));
        let client = client({
            let seen = seen.clone();
            move |method, path, body| {
                seen.lock().unwrap().push(format!("{method} {path} {body}"));
                match (method, path) {
                    ("POST", "/v1/accounts/login") => (200, r#"{"loginId":"L1"}"#.into()),
                    ("GET", "/v1/accounts/login/L1") => (200, r#"{"status":"pending","loginId":"L1","events":[{"type":"auth_url","url":"https://x/auth"}],"pendingPrompt":{"id":"P1","prompt":{"type":"manual_code","message":"Paste the code"}}}"#.into()),
                    ("POST", "/v1/accounts/login/L1/submit") => (200, r#"{"ok":true}"#.into()),
                    ("DELETE", "/v1/accounts/login/L1") => (204, String::new()),
                    ("DELETE", "/v1/accounts/anthropic") => (204, String::new()),
                    _ => (404, "{}".into()),
                }
            }
        });
        smol::block_on(async {
            assert_eq!(client.start_login("anthropic", LoginKind::Oauth).await.unwrap(), "L1");
            let LoginState::Pending { events, pending_prompt, .. } = client.login_state("L1").await.unwrap() else {
                panic!("expected pending");
            };
            assert!(matches!(&events[0], LoginEvent::AuthUrl { url, .. } if url == "https://x/auth"));
            assert_eq!(pending_prompt.unwrap().prompt.kind, PromptKind::ManualCode);
            client.submit_login("L1", "code").await.unwrap();
            client.cancel_login("L1").await.unwrap();
            client.sign_out("anthropic").await.unwrap();
        });
        let seen = seen.lock().unwrap();
        assert_eq!(seen[0], r#"POST /v1/accounts/login {"providerId":"anthropic","type":"oauth"}"#);
        assert_eq!(seen[2], r#"POST /v1/accounts/login/L1/submit {"value":"code"}"#);
        assert_eq!(seen[3], "DELETE /v1/accounts/login/L1 ");
        assert_eq!(seen[4], "DELETE /v1/accounts/anthropic ");
    }

    #[test]
    fn a_completion_posts_prefix_and_suffix_and_returns_the_text() {
        let client = client(|_, path, body| {
            assert_eq!(path, "/v1/completions");
            assert!(body.contains(r#""prompt":"fn main() {""#) && body.contains(r#""suffix":"}""#) && body.contains(r#""max_tokens":64"#), "{body}");
            (200, r#"{"choices":[{"index":0,"text":"\n    println!(\"hi\");\n","finish_reason":"stop"}]}"#.into())
        });
        let text = smol::block_on(client.completion("anthropic/claude-opus-5", "fn main() {", "}", 64)).unwrap();
        assert_eq!(text, "\n    println!(\"hi\");\n");
    }

    #[test]
    fn events_are_parsed_from_sse_and_comments_are_skipped() {
        let stream = ": connected\n\nevent: account.changed\ndata: {\"type\":\"account.changed\",\"providerId\":\"anthropic\",\"authenticated\":true}\n\n: heartbeat\n\nevent: session.delta\ndata: {\"type\":\"session.delta\",\"sessionId\":\"s\"}\n\nevent: models.changed\ndata: {\"type\":\"models.changed\"}\n\n";
        let client = client(move |_, path, _| {
            assert_eq!(path, "/events");
            (200, stream.to_string())
        });
        let mut seen = Vec::new();
        smol::block_on(client.events(|event| seen.push(event))).unwrap();
        assert_eq!(
            seen,
            vec![
                EngineEvent::AccountChanged { provider_id: "anthropic".into(), authenticated: true },
                EngineEvent::Other,
                EngineEvent::ModelsChanged,
            ]
        );
    }

    #[test]
    fn a_refused_event_stream_is_a_status_error() {
        let client = client(|_, _, _| (401, r#"{"error":"unauthorized"}"#.into()));
        assert!(matches!(smol::block_on(client.events(|_| {})).unwrap_err(), ClientError::Status { status: 401, .. }));
    }
}
```

The `client` helper moves the handler into the fake and captures the
request body first, so a test can assert on what was posted; `Mutex` is
for the `seen` log in the login-routes test.

`login.rs` tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{Endpoint, EngineClient};
    use http_client::{AsyncBody, FakeHttpClient, Response};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// A login that is pending with an auth_url for the first two polls,
    /// then complete.
    fn client_for(states: &'static [&'static str]) -> EngineClient {
        let polls = Arc::new(AtomicUsize::new(0));
        let http = FakeHttpClient::create(move |request| {
            let polls = polls.clone();
            let path = request.uri().path().to_string();
            async move {
                let body = match path.as_str() {
                    "/v1/accounts/login" => r#"{"loginId":"L1"}"#.to_string(),
                    "/v1/accounts/login/L1" => {
                        let index = polls.fetch_add(1, Ordering::SeqCst).min(states.len() - 1);
                        states[index].to_string()
                    }
                    "/v1/accounts/login/L1/submit" => r#"{"ok":true}"#.to_string(),
                    _ => "{}".to_string(),
                };
                Ok(Response::builder().status(200).body(AsyncBody::from(body)).unwrap())
            }
        });
        EngineClient::new(http, Endpoint { url: "http://127.0.0.1:1".into(), token: "t".into() })
    }

    const PENDING_URL: &str = r#"{"status":"pending","loginId":"L1","events":[{"type":"auth_url","url":"https://x/auth"}]}"#;
    const PENDING_PROMPT: &str = r#"{"status":"pending","loginId":"L1","events":[{"type":"auth_url","url":"https://x/auth"}],"pendingPrompt":{"id":"P1","prompt":{"type":"secret","message":"API key"}}}"#;
    const COMPLETE: &str = r#"{"status":"complete","loginId":"L1","events":[{"type":"auth_url","url":"https://x/auth"},{"type":"progress","message":"done"}]}"#;
    const FAILED: &str = r#"{"status":"failed","loginId":"L1","events":[],"error":"login cancelled"}"#;

    #[test]
    fn advance_reports_each_event_once_and_returns_complete() {
        smol::block_on(async {
            let mut login = Login::start(client_for(&[PENDING_URL, PENDING_URL, COMPLETE]), "anthropic", LoginKind::Oauth).await.unwrap();
            login.poll_interval = Duration::from_millis(1);
            let mut seen = Vec::new();
            let outcome = login.advance(|event| seen.push(format!("{event:?}"))).await.unwrap();
            assert!(matches!(outcome, LoginOutcome::Complete));
            assert_eq!(seen.len(), 2, "{seen:?}");
            assert!(seen[0].contains("https://x/auth"));
        });
    }

    #[test]
    fn advance_returns_a_pending_prompt_and_resumes_after_submit() {
        smol::block_on(async {
            let mut login = Login::start(client_for(&[PENDING_PROMPT, COMPLETE]), "openai", LoginKind::ApiKey).await.unwrap();
            login.poll_interval = Duration::from_millis(1);
            let LoginOutcome::Prompt(prompt) = login.advance(|_| {}).await.unwrap() else {
                panic!("expected a prompt");
            };
            assert_eq!(prompt.id, "P1");
            login.submit("sk-test").await.unwrap();
            assert!(matches!(login.advance(|_| {}).await.unwrap(), LoginOutcome::Complete));
        });
    }

    #[test]
    fn a_failed_login_is_an_error_with_the_engine_reason() {
        smol::block_on(async {
            let mut login = Login::start(client_for(&[FAILED]), "anthropic", LoginKind::Oauth).await.unwrap();
            login.poll_interval = Duration::from_millis(1);
            let error = login.advance(|_| {}).await.unwrap_err();
            assert!(matches!(&error, LoginError::Failed(reason) if reason == "login cancelled"), "{error}");
        });
    }
}
```

`engine.rs` tests (gpui):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;

    #[test]
    fn three_exits_in_a_minute_stop_the_restarts() {
        let now = Instant::now();
        let mut exits = VecDeque::new();
        assert_eq!(restart_delay(&exits, now), Some(Duration::from_secs(1)));
        exits.push_back(now - Duration::from_secs(50));
        assert_eq!(restart_delay(&exits, now), Some(Duration::from_secs(2)));
        exits.push_back(now - Duration::from_secs(20));
        assert_eq!(restart_delay(&exits, now), Some(Duration::from_secs(4)));
        exits.push_back(now - Duration::from_secs(5));
        assert_eq!(restart_delay(&exits, now), None);
        // Older than a minute no longer counts.
        let mut old = VecDeque::from([now - Duration::from_secs(120), now - Duration::from_secs(90), now - Duration::from_secs(61)]);
        assert_eq!(restart_delay(&old, now), Some(Duration::from_secs(1)));
        old.push_back(now);
        assert_eq!(restart_delay(&old, now), Some(Duration::from_secs(2)));
    }

    #[gpui::test]
    async fn ready_surfaces_a_failed_engine_verbatim(cx: &mut TestAppContext) {
        let engine = cx.update(|cx| Engine::failed_for_tests("knightcode-engine was not found at C:/nope", cx));
        let error = cx.update(|cx| engine.update(cx, |engine, cx| engine.ready(cx))).await.unwrap_err();
        assert_eq!(error.to_string(), "knightcode-engine was not found at C:/nope");
        assert!(cx.read(|cx| engine.read(cx).endpoint()).is_none());
    }

    #[gpui::test]
    async fn ready_resolves_when_the_engine_becomes_ready(cx: &mut TestAppContext) {
        let engine = cx.update(|cx| Engine::starting_for_tests(cx));
        let waiting = cx.update(|cx| engine.update(cx, |engine, cx| engine.ready(cx)));
        let endpoint = Endpoint { url: "http://127.0.0.1:4545".into(), token: "t".into() };
        cx.update(|cx| engine.update(cx, |engine, cx| engine.set_ready_for_tests(endpoint.clone(), cx)));
        assert_eq!(waiting.await.unwrap().url, endpoint.url);
        assert_eq!(cx.read(|cx| engine.read(cx).endpoint()).unwrap().url, endpoint.url);
    }
}
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p knightcode_engine`
Expected: compile errors on the missing modules.

- [x] **Step 3: Write minimal implementation**

```rust
// crates/knightcode_engine/src/client.rs
//! The engine's HTTP routes as the IDE calls them. Every request carries
//! the launch token; no response type has a field for a key, a token or a
//! refresh token, so none can be stored by accident.

use anyhow::{Result, anyhow};
use futures::{AsyncBufReadExt as _, AsyncReadExt as _, StreamExt as _, io::BufReader};
use http_client::{AsyncBody, HttpClient, Method, Request};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::sync::Arc;

#[derive(Clone, Debug, PartialEq)]
pub struct Endpoint {
    pub url: String,
    pub token: Arc<str>,
}

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("{message} (HTTP {status}, {code})")]
    Status { status: u16, code: String, message: String },
    #[error("{0:#}")]
    Transport(#[from] anyhow::Error),
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LoginKind {
    ApiKey,
    Oauth,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub provider_id: String,
    pub provider_name: String,
    #[serde(rename = "type")]
    pub kind: LoginKind,
    pub is_subscription: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoginOption {
    pub provider_id: String,
    pub provider_name: String,
    #[serde(rename = "type")]
    pub kind: LoginKind,
    pub label: String,
    pub is_subscription: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Accounts {
    pub accounts: Vec<Account>,
    pub login_options: Vec<LoginOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineModel {
    /// `<providerId>/<modelId>`; what every request names. `id` alone is ambiguous.
    #[serde(rename = "ref")]
    pub reference: String,
    pub id: String,
    pub provider_id: String,
    pub provider_name: String,
    pub name: String,
    pub context_window: u64,
    pub max_tokens: u64,
    pub reasoning: bool,
    pub input: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LoginEvent {
    Info { message: String },
    AuthUrl { url: String, instructions: Option<String> },
    #[serde(rename_all = "camelCase")]
    DeviceCode { user_code: String, verification_uri: String },
    Progress { message: String },
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PromptKind {
    Text,
    Secret,
    Select,
    ManualCode,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct PromptOption {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct LoginPrompt {
    #[serde(rename = "type")]
    pub kind: PromptKind,
    pub message: String,
    pub placeholder: Option<String>,
    #[serde(default)]
    pub options: Vec<PromptOption>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct PendingPrompt {
    pub id: String,
    pub prompt: LoginPrompt,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum LoginState {
    #[serde(rename_all = "camelCase")]
    Pending { login_id: String, events: Vec<LoginEvent>, pending_prompt: Option<PendingPrompt> },
    #[serde(rename_all = "camelCase")]
    Complete { login_id: String, events: Vec<LoginEvent> },
    #[serde(rename_all = "camelCase")]
    Failed { login_id: String, events: Vec<LoginEvent>, error: String },
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum EngineEvent {
    #[serde(rename = "account.changed", rename_all = "camelCase")]
    AccountChanged { provider_id: String, authenticated: bool },
    #[serde(rename = "models.changed")]
    ModelsChanged,
    /// Session events and anything added later; the IDE ignores them.
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct ErrorBody {
    #[serde(default)]
    error: serde_json::Value,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Deserialize)]
struct CompletionBody {
    choices: Vec<CompletionChoice>,
}

#[derive(Deserialize)]
struct CompletionChoice {
    text: String,
}

#[derive(Clone)]
pub struct EngineClient {
    http: Arc<dyn HttpClient>,
    endpoint: Endpoint,
}

impl EngineClient {
    pub fn new(http: Arc<dyn HttpClient>, endpoint: Endpoint) -> Self {
        Self { http, endpoint }
    }

    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    fn request(&self, method: Method, path: &str, body: Option<serde_json::Value>) -> Result<Request<AsyncBody>> {
        let mut builder = Request::builder()
            .method(method)
            .uri(format!("{}{path}", self.endpoint.url))
            .header("Authorization", format!("Bearer {}", self.endpoint.token));
        let body = match body {
            Some(body) => {
                builder = builder.header("Content-Type", "application/json");
                AsyncBody::from(serde_json::to_string(&body)?)
            }
            None => AsyncBody::empty(),
        };
        Ok(builder.body(body)?)
    }

    async fn call<T: DeserializeOwned>(&self, method: Method, path: &str, body: Option<serde_json::Value>) -> Result<T, ClientError> {
        let request = self.request(method, path, body)?;
        let mut response = self.http.send(request).await?;
        let mut text = String::new();
        response.body_mut().read_to_string(&mut text).await.map_err(anyhow::Error::from)?;
        let status = response.status().as_u16();
        if !response.status().is_success() {
            let parsed: Option<ErrorBody> = serde_json::from_str(&text).ok();
            let code = parsed
                .as_ref()
                .and_then(|body| body.error.as_str().map(str::to_owned).or_else(|| body.error.get("type")?.as_str().map(str::to_owned)))
                .unwrap_or_else(|| "error".to_owned());
            let message = parsed
                .and_then(|body| body.message.or_else(|| body.error.get("message")?.as_str().map(str::to_owned)))
                .unwrap_or_else(|| format!("{path} failed with HTTP {status}"));
            return Err(ClientError::Status { status, code, message });
        }
        if text.is_empty() {
            // 204: the caller asked for `()` and gets it.
            return serde_json::from_str("null").map_err(|error| anyhow!(error).into());
        }
        serde_json::from_str(&text).map_err(|error| anyhow!("{path}: unexpected body: {error}").into())
    }

    pub async fn accounts(&self) -> Result<Accounts, ClientError> {
        self.call(Method::GET, "/v1/accounts", None).await
    }

    pub async fn models(&self) -> Result<Vec<EngineModel>, ClientError> {
        #[derive(Deserialize)]
        struct Models {
            models: Vec<EngineModel>,
        }
        Ok(self.call::<Models>(Method::GET, "/v1/models", None).await?.models)
    }

    pub async fn start_login(&self, provider_id: &str, kind: LoginKind) -> Result<String, ClientError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Started {
            login_id: String,
        }
        let body = serde_json::json!({ "providerId": provider_id, "type": kind });
        Ok(self.call::<Started>(Method::POST, "/v1/accounts/login", Some(body)).await?.login_id)
    }

    pub async fn login_state(&self, login_id: &str) -> Result<LoginState, ClientError> {
        self.call(Method::GET, &format!("/v1/accounts/login/{login_id}"), None).await
    }

    pub async fn submit_login(&self, login_id: &str, value: &str) -> Result<(), ClientError> {
        let body = serde_json::json!({ "value": value });
        self.call::<serde_json::Value>(Method::POST, &format!("/v1/accounts/login/{login_id}/submit"), Some(body)).await?;
        Ok(())
    }

    pub async fn cancel_login(&self, login_id: &str) -> Result<(), ClientError> {
        self.call::<()>(Method::DELETE, &format!("/v1/accounts/login/{login_id}"), None).await
    }

    pub async fn sign_out(&self, provider_id: &str) -> Result<(), ClientError> {
        self.call::<()>(Method::DELETE, &format!("/v1/accounts/{provider_id}"), None).await
    }

    /// Seam 3: one fill-in-the-middle completion.
    pub async fn completion(&self, model: &str, prefix: &str, suffix: &str, max_tokens: u32) -> Result<String, ClientError> {
        let body = serde_json::json!({ "model": model, "prompt": prefix, "suffix": suffix, "max_tokens": max_tokens });
        let completion: CompletionBody = self.call(Method::POST, "/v1/completions", Some(body)).await?;
        Ok(completion.choices.into_iter().next().map(|choice| choice.text).unwrap_or_default())
    }

    /// Consume `/events` until the stream ends. Comments (the preamble and
    /// heartbeats) are skipped; a frame is delivered when its blank line
    /// arrives.
    pub async fn events(&self, mut on_event: impl FnMut(EngineEvent)) -> Result<(), ClientError> {
        let request = self.request(Method::GET, "/events", None)?;
        let response = self.http.send(request).await?;
        if !response.status().is_success() {
            return Err(ClientError::Status {
                status: response.status().as_u16(),
                code: "events".into(),
                message: "the event stream was refused".into(),
            });
        }
        let mut lines = BufReader::new(response.into_body()).lines();
        let mut data = String::new();
        while let Some(line) = lines.next().await {
            let line = line.map_err(anyhow::Error::from)?;
            if line.is_empty() {
                if !data.is_empty() {
                    match serde_json::from_str::<EngineEvent>(&data) {
                        Ok(event) => on_event(event),
                        Err(error) => log::warn!("knightcode-engine: unreadable event {data}: {error}"),
                    }
                    data.clear();
                }
            } else if let Some(rest) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(rest.trim_start());
            }
        }
        Ok(())
    }
}
```

```rust
// crates/knightcode_engine/src/login.rs
//! One login, driven from the IDE: start it on the engine, poll its state,
//! report each event once (a URL to open, a device code to show), park on a
//! prompt the UI must answer, and end complete or failed. The engine holds
//! the OAuth exchange and writes the credential; this side only relays.

use crate::client::{ClientError, EngineClient, LoginEvent, LoginKind, LoginState, PendingPrompt};
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum LoginError {
    #[error("{0}")]
    Failed(String),
    #[error(transparent)]
    Client(#[from] ClientError),
}

pub enum LoginOutcome {
    Complete,
    /// The engine needs a value from the user; `submit`, then `advance` again.
    Prompt(PendingPrompt),
}

pub struct Login {
    client: EngineClient,
    pub id: String,
    reported: usize,
    pub poll_interval: Duration,
}

impl Login {
    pub async fn start(client: EngineClient, provider_id: &str, kind: LoginKind) -> Result<Self, ClientError> {
        let id = client.start_login(provider_id, kind).await?;
        Ok(Self { client, id, reported: 0, poll_interval: Duration::from_millis(500) })
    }

    pub async fn advance(&mut self, mut on_event: impl FnMut(&LoginEvent)) -> Result<LoginOutcome, LoginError> {
        loop {
            let state = self.client.login_state(&self.id).await?;
            let (events, outcome) = match state {
                LoginState::Pending { events, pending_prompt, .. } => (events, pending_prompt.map(LoginOutcome::Prompt)),
                LoginState::Complete { events, .. } => (events, Some(LoginOutcome::Complete)),
                LoginState::Failed { error, .. } => return Err(LoginError::Failed(error)),
            };
            for event in events.iter().skip(self.reported) {
                on_event(event);
            }
            self.reported = self.reported.max(events.len());
            if let Some(outcome) = outcome {
                return Ok(outcome);
            }
            smol::Timer::after(self.poll_interval).await;
        }
    }

    pub async fn submit(&self, value: &str) -> Result<(), ClientError> {
        self.client.submit_login(&self.id, value).await
    }

    pub async fn cancel(&self) -> Result<(), ClientError> {
        self.client.cancel_login(&self.id).await
    }
}
```

```rust
// crates/knightcode_engine/src/engine.rs
//! The engine's lifetime as a gpui entity: one per application, started at
//! launch, restarted with backoff, released at quit. Everything that needs
//! the engine asks this entity for an `Endpoint`; nothing else spawns it.

use crate::client::{Endpoint, EngineClient, EngineEvent as WireEvent};
use crate::environment::{self, TOKEN_ENV};
use crate::process::{self, EngineCommand, EngineProcess, ExitOutcome, STALL_TIMEOUT, StartError};
use crate::settings::EngineSettings;
use anyhow::{Result, anyhow};
use futures::{FutureExt as _, StreamExt as _, channel::{mpsc, oneshot}};
use gpui::{App, AppContext as _, Context, Entity, EventEmitter, Global, SharedString, Task};
use http_client::HttpClient;
use settings::{Settings as _, SettingsStore};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

const RESTART_WINDOW: Duration = Duration::from_secs(60);
const RESTART_LIMIT: usize = 3;
const EVENTS_RETRY: Duration = Duration::from_secs(1);

#[derive(Clone, Debug)]
pub enum EngineStatus {
    Starting,
    Ready(Endpoint),
    Failed(SharedString),
}

#[derive(Clone, Debug)]
pub enum EngineEvent {
    Ready(Endpoint),
    Failed(SharedString),
    Stopped,
    AccountChanged { provider_id: String, authenticated: bool },
    ModelsChanged,
}

struct GlobalEngine(Entity<Engine>);

impl Global for GlobalEngine {}

pub struct Engine {
    status: EngineStatus,
    process: Option<EngineProcess>,
    binary: Option<PathBuf>,
    token: Arc<str>,
    pinned_port: Option<u16>,
    exits: VecDeque<Instant>,
    proxy: Vec<(String, String)>,
    http: Arc<dyn HttpClient>,
    settings: EngineSettings,
    /// Incremented on every start; a task from an older generation must not act.
    generation: usize,
    waiters: Vec<oneshot::Sender<Result<Endpoint, SharedString>>>,
    _tasks: Vec<Task<()>>,
}

impl EventEmitter<EngineEvent> for Engine {}

/// The delay before the next restart, or `None` once `RESTART_LIMIT` exits
/// fall inside `RESTART_WINDOW`. Exits older than the window are forgotten.
pub fn restart_delay(exits: &VecDeque<Instant>, now: Instant) -> Option<Duration> {
    let recent = exits.iter().filter(|at| now.duration_since(**at) < RESTART_WINDOW).count();
    (recent < RESTART_LIMIT).then(|| Duration::from_secs(1 << recent))
}

/// `shell_env_loaded` is `main`'s signal that the login shell's environment
/// has been applied to the process; the engine inherits `PATH` from it, so
/// the first start waits. `None` when there is nothing to wait for.
pub fn init(
    proxy: Vec<(String, String)>,
    shell_env_loaded: Option<oneshot::Receiver<()>>,
    cx: &mut App,
) -> Entity<Engine> {
    EngineSettings::register(cx);
    let engine = cx.new(|cx| Engine::new(proxy, cx));
    cx.set_global(GlobalEngine(engine.clone()));
    cx.on_app_quit({
        let engine = engine.clone();
        move |cx| {
            engine.update(cx, |engine, _| engine.release());
            async {}
        }
    })
    .detach();
    match shell_env_loaded {
        Some(loaded) => cx
            .spawn({
                let engine = engine.clone();
                async move |cx| {
                    loaded.await.ok();
                    engine.update(cx, |engine, cx| engine.start(cx)).ok();
                }
            })
            .detach(),
        None => engine.update(cx, |engine, cx| engine.start(cx)),
    }
    engine
}

pub fn global(cx: &App) -> Entity<Engine> {
    cx.global::<GlobalEngine>().0.clone()
}

pub fn try_global(cx: &App) -> Option<Entity<Engine>> {
    cx.try_global::<GlobalEngine>().map(|global| global.0.clone())
}

impl Engine {
    fn new(proxy: Vec<(String, String)>, cx: &mut Context<Self>) -> Self {
        let settings = EngineSettings::get_global(cx).clone();
        cx.observe_global::<SettingsStore>(|this, cx| {
            let settings = EngineSettings::get_global(cx).clone();
            if settings.engine_path != this.settings.engine_path || settings.engine_url != this.settings.engine_url {
                this.settings = settings;
                this.restart(cx);
            } else {
                this.settings = settings;
            }
        })
        .detach();
        Self {
            status: EngineStatus::Starting,
            process: None,
            binary: None,
            token: environment::generate_token().into(),
            pinned_port: None,
            exits: VecDeque::new(),
            proxy,
            http: cx.http_client(),
            settings,
            generation: 0,
            waiters: Vec::new(),
            _tasks: Vec::new(),
        }
    }

    pub fn status(&self) -> &EngineStatus {
        &self.status
    }

    pub fn endpoint(&self) -> Option<Endpoint> {
        match &self.status {
            EngineStatus::Ready(endpoint) => Some(endpoint.clone()),
            _ => None,
        }
    }

    pub fn client(&self) -> Option<EngineClient> {
        self.endpoint().map(|endpoint| EngineClient::new(self.http.clone(), endpoint))
    }

    /// The binary the running engine was started from; what the ACP adapter
    /// is spawned from too.
    pub fn binary(&self) -> Option<&Path> {
        self.binary.as_deref()
    }

    /// Resolves once the engine is `Ready`, or fails with the `Failed` message.
    pub fn ready(&mut self, cx: &mut Context<Self>) -> Task<Result<Endpoint>> {
        match &self.status {
            EngineStatus::Ready(endpoint) => Task::ready(Ok(endpoint.clone())),
            EngineStatus::Failed(message) => Task::ready(Err(anyhow!("{message}"))),
            EngineStatus::Starting => {
                let (tx, rx) = oneshot::channel();
                self.waiters.push(tx);
                cx.background_spawn(async move {
                    rx.await
                        .map_err(|_| anyhow!("the engine was dropped"))?
                        .map_err(|message| anyhow!("{message}"))
                })
            }
        }
    }

    /// Close the engine's stdin. It shuts down on its own; this is what a
    /// quit does within gpui's 200 ms.
    pub fn release(&mut self) {
        if let Some(process) = &mut self.process {
            process.release();
        }
    }

    pub fn restart(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        self.exits.clear();
        if let Some(process) = self.process.take() {
            self.pinned_port = Some(process.port);
            cx.background_spawn(async move {
                process.stop().await;
            })
            .detach();
        }
        self.start(cx);
    }

    fn set_status(&mut self, status: EngineStatus, cx: &mut Context<Self>) {
        self.status = status.clone();
        let event = match &status {
            EngineStatus::Ready(endpoint) => Some(EngineEvent::Ready(endpoint.clone())),
            EngineStatus::Failed(message) => Some(EngineEvent::Failed(message.clone())),
            EngineStatus::Starting => None,
        };
        let outcome = match &status {
            EngineStatus::Ready(endpoint) => Some(Ok(endpoint.clone())),
            EngineStatus::Failed(message) => Some(Err(message.clone())),
            EngineStatus::Starting => None,
        };
        if let Some(outcome) = outcome {
            for waiter in self.waiters.drain(..) {
                waiter.send(outcome.clone()).ok();
            }
        }
        if let Some(event) = event {
            cx.emit(event);
        }
        cx.notify();
    }

    fn start(&mut self, cx: &mut Context<Self>) {
        self.generation += 1;
        let generation = self.generation;
        self.set_status(EngineStatus::Starting, cx);

        if let Some(url) = self.settings.engine_url.clone() {
            // Attach: no process, no restart; the token must already be in the
            // environment. Readiness is the token check alone.
            let Ok(token) = std::env::var(TOKEN_ENV) else {
                self.set_status(EngineStatus::Failed(format!("knightcode.engine_url is set but {TOKEN_ENV} is not in the environment").into()), cx);
                return;
            };
            let endpoint = Endpoint { url: url.trim_end_matches('/').to_owned(), token: token.into() };
            let client = EngineClient::new(self.http.clone(), endpoint.clone());
            self._tasks.push(cx.spawn(async move |this, cx| {
                let outcome = client.accounts().await;
                this.update(cx, |this, cx| {
                    if this.generation != generation {
                        return;
                    }
                    match outcome {
                        Ok(_) => {
                            this.set_status(EngineStatus::Ready(endpoint), cx);
                            this.watch_events(generation, cx);
                        }
                        Err(error) => this.set_status(EngineStatus::Failed(format!("could not reach the engine at {url}: {error}").into()), cx),
                    }
                })
                .ok();
            }));
            return;
        }

        let binary = match environment::locate_binary(
            self.settings.engine_path.as_deref(),
            std::env::var_os(environment::PATH_ENV).map(PathBuf::from).as_deref(),
            std::env::current_exe().ok().and_then(|exe| exe.parent().map(Path::to_path_buf)).as_deref(),
        ) {
            Ok(binary) => binary,
            Err(error) => {
                self.set_status(EngineStatus::Failed(error.to_string().into()), cx);
                return;
            }
        };
        self.binary = Some(binary.clone());
        let (set, remove) = environment::engine_environment(&self.token, self.pinned_port, &self.proxy);
        let command = EngineCommand { program: binary, args: Vec::new(), set, remove };
        let token = self.token.clone();
        let http = self.http.clone();
        let pinned = self.pinned_port;

        self._tasks.push(cx.spawn(async move |this, cx| {
            let outcome = process::start(command, &token, http, STALL_TIMEOUT).await;
            this.update(cx, |this, cx| {
                if this.generation != generation {
                    // A restart superseded this start; its process is not ours to keep.
                    if let Ok(process) = outcome {
                        cx.background_spawn(async move {
                            process.stop().await;
                        })
                        .detach();
                    }
                    return;
                }
                match outcome {
                    Ok(process) => {
                        let endpoint = Endpoint { url: format!("http://127.0.0.1:{}", process.port), token: token.clone() };
                        let exit = process.exit();
                        this.process = Some(process);
                        this.set_status(EngineStatus::Ready(endpoint), cx);
                        this.watch_exit(generation, exit, cx);
                        this.watch_events(generation, cx);
                    }
                    Err(StartError::ExitedBeforeReady { stderr, .. }) if pinned.is_some() && stderr.contains("EADDRINUSE") => {
                        // The old port is gone for good; the adapters will not find us, but the IDE will.
                        log::warn!("knightcode-engine: pinned port in use; starting on an ephemeral port");
                        this.pinned_port = None;
                        this.start(cx);
                    }
                    Err(error) => this.set_status(EngineStatus::Failed(error.to_string().into()), cx),
                }
            })
            .ok();
        }));
    }

    fn watch_exit(&mut self, generation: usize, exit: impl Future<Output = ExitOutcome> + 'static, cx: &mut Context<Self>) {
        self._tasks.push(cx.spawn(async move |this, cx| {
            let outcome = exit.await;
            this.update(cx, |this, cx| this.on_exit(generation, outcome, cx)).ok();
        }));
    }

    fn on_exit(&mut self, generation: usize, outcome: ExitOutcome, cx: &mut Context<Self>) {
        if generation != self.generation {
            return;
        }
        let port = self.process.take().map(|process| process.port);
        cx.emit(EngineEvent::Stopped);
        let now = Instant::now();
        let status = outcome.status.map(|status| status.to_string()).unwrap_or_else(|| "unknown status".into());
        match restart_delay(&self.exits, now) {
            Some(delay) => {
                log::warn!("knightcode-engine exited ({status}); restarting in {delay:?}");
                self.exits.push_back(now);
                self.pinned_port = port;
                self.set_status(EngineStatus::Starting, cx);
                self._tasks.push(cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(delay).await;
                    this.update(cx, |this, cx| {
                        if this.generation == generation {
                            this.start(cx);
                        }
                    })
                    .ok();
                }));
            }
            None => {
                let tail = if outcome.stderr.is_empty() { String::new() } else { format!(":\n{}", outcome.stderr) };
                self.set_status(
                    EngineStatus::Failed(format!("knightcode-engine exited {RESTART_LIMIT} times within a minute; last exit {status}{tail}").into()),
                    cx,
                );
            }
        }
    }

    /// Relay `account.changed` and `models.changed` from `/events` as entity
    /// events, reconnecting after a drop for as long as this generation runs.
    fn watch_events(&mut self, generation: usize, cx: &mut Context<Self>) {
        let Some(client) = self.client() else {
            return;
        };
        let (tx, mut rx) = mpsc::unbounded::<WireEvent>();
        let reader = cx.background_spawn(async move {
            loop {
                let outcome = client.events(|event| {
                    tx.unbounded_send(event).ok();
                }).await;
                if tx.is_closed() {
                    return;
                }
                if let Err(error) = outcome {
                    log::warn!("knightcode-engine: event stream dropped: {error}");
                }
                smol::Timer::after(EVENTS_RETRY).await;
            }
        });
        self._tasks.push(cx.spawn(async move |this, cx| {
            let _reader = reader;
            while let Some(event) = rx.next().await {
                let stop = this
                    .update(cx, |this, cx| {
                        if this.generation != generation {
                            return true;
                        }
                        match event {
                            WireEvent::AccountChanged { provider_id, authenticated } => cx.emit(EngineEvent::AccountChanged { provider_id, authenticated }),
                            WireEvent::ModelsChanged => cx.emit(EngineEvent::ModelsChanged),
                            WireEvent::Other => {}
                        }
                        false
                    })
                    .unwrap_or(true);
                if stop {
                    break;
                }
            }
        }));
    }
}

#[cfg(any(test, feature = "test-support"))]
impl Engine {
    /// Every test constructor also installs the global, because `connect`
    /// and the provider reach the engine through `global(cx)`.
    fn for_tests(status: EngineStatus, cx: &mut App) -> Entity<Engine> {
        let http = cx.http_client();
        let engine = cx.new(|_| Engine {
            status,
            process: None,
            binary: None,
            token: "test-token".into(),
            pinned_port: None,
            exits: VecDeque::new(),
            proxy: Vec::new(),
            http,
            settings: EngineSettings::default(),
            generation: 0,
            waiters: Vec::new(),
            _tasks: Vec::new(),
        });
        cx.set_global(GlobalEngine(engine.clone()));
        engine
    }

    pub fn failed_for_tests(message: &str, cx: &mut App) -> Entity<Engine> {
        Self::for_tests(EngineStatus::Failed(message.to_owned().into()), cx)
    }

    pub fn starting_for_tests(cx: &mut App) -> Entity<Engine> {
        Self::for_tests(EngineStatus::Starting, cx)
    }

    pub fn ready_for_tests(endpoint: Endpoint, http: Arc<dyn HttpClient>, cx: &mut App) -> Entity<Engine> {
        let engine = Self::for_tests(EngineStatus::Ready(endpoint), cx);
        engine.update(cx, |engine, _| engine.http = http);
        engine
    }

    pub fn set_ready_for_tests(&mut self, endpoint: Endpoint, cx: &mut Context<Self>) {
        self.set_status(EngineStatus::Ready(endpoint), cx);
    }
}
```

Add a `test-support = []` feature to the crate's `Cargo.toml` (the other
two crates enable it in their dev-dependencies). `knightcode_engine.rs`
gains `pub mod client; pub mod engine; pub mod login;` and
`pub use client::{Endpoint, EngineClient, LoginKind, LoginOption};
pub use engine::{Engine, EngineEvent, EngineStatus, global, init, try_global};`.

The settings observer in `Engine::new` needs `EngineSettings` registered
before the entity exists — `init` does that first. The test constructors
bypass settings entirely.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p knightcode_engine`
Expected: PASS. The two gpui tests need `SettingsStore::test(cx)`? No —
the test constructors read no settings. If `cx.http_client()` panics in a
`TestAppContext` without one, set `FakeHttpClient::with_404_response()`
via `cx.update(|cx| cx.set_http_client(..))` at the top of each gpui test
and record it.

- [x] **Step 5: Commit**

```bash
git add crates/knightcode_engine
git commit -m "feat(knightcode_engine): add the engine client, login driver and lifecycle entity"
```

---

## Task 4: `knightcode_agent` — seam 1

**Files (fork):**
- Create: `crates/knightcode_agent/Cargo.toml`, `src/knightcode_agent.rs`,
  `src/connection.rs`
- Modify: `Cargo.toml` (member, workspace dependency),
  `crates/agent_ui/Cargo.toml` (one dependency),
  `crates/agent_ui/src/agent_ui.rs` (the match arm)

**Interfaces:**
- Consumes: `agent_servers::{AgentServer, AgentServerDelegate, AcpConnection, CustomAgentServer}`,
  `acp_thread::AgentConnection`, `project::{AgentId, Project, agent_server_store::{AgentServerCommand, AllAgentServersSettings}}`,
  `agent::ZED_AGENT_ID`, `knightcode_engine::{Engine, EngineClient, Login, LoginKind, LoginOption, LoginOutcome, environment::TOKEN_ENV}`.
- Produces:
  - `pub struct KnightCodeAgentServer` with `pub fn new() -> Self` and
    `impl AgentServer` (`agent_id` is `ZED_AGENT_ID`; `connect` as below;
    the six settings-backed defaults delegate to a `CustomAgentServer`
    for the same id).
  - `pub struct KnightCodeConnection` with
    `pub fn new(inner: Rc<AcpConnection>, engine: Entity<Engine>, login_options: Vec<LoginOption>) -> Self`,
    `pub fn method_id(option: &LoginOption) -> String` (`knightcode:<providerId>`),
    and `impl AgentConnection` delegating every method to `inner` except
    `auth_methods`, `authenticate` and `into_any`.

Before this task can be validated in the running IDE, the engine binary
must carry Task 0 and the `acp` subcommand: ask, then `bun run
build:engine` in this repository, and point `knightcode.engine_path` (or
`KNIGHTCODE_ENGINE_PATH`) at `packages/cli-win32-x64/bin/knightcode-engine.exe`
with forward slashes.

- [x] **Step 1: Write the failing tests**

```rust
// crates/knightcode_agent/src/knightcode_agent.rs (tests module)
#[cfg(test)]
mod tests {
    use super::*;
    use acp_thread::AgentConnection as _;
    use agent_client_protocol::schema::v1 as acp;
    use agent_servers::{AgentServerDelegate, connect_fake_acp_connection};
    use fs::FakeFs;
    use gpui::TestAppContext;
    use http_client::{AsyncBody, FakeHttpClient, Response};
    use knightcode_engine::{Endpoint, Engine, LoginKind, LoginOption};
    use project::Project;
    use settings::SettingsStore;

    fn init_test(cx: &mut TestAppContext) {
        cx.update(|cx| {
            let settings_store = SettingsStore::test(cx);
            cx.set_global(settings_store);
            cx.set_http_client(FakeHttpClient::with_404_response());
        });
    }

    fn options() -> Vec<LoginOption> {
        vec![
            LoginOption { provider_id: "anthropic".into(), provider_name: "Anthropic".into(), kind: LoginKind::Oauth, label: "Anthropic (Claude Pro/Max)".into(), is_subscription: true },
            LoginOption { provider_id: "openai".into(), provider_name: "OpenAI".into(), kind: LoginKind::ApiKey, label: "OpenAI API key".into(), is_subscription: false },
        ]
    }

    #[gpui::test]
    async fn connect_surfaces_the_engine_failure_verbatim(cx: &mut TestAppContext) {
        init_test(cx);
        cx.update(|cx| Engine::failed_for_tests("knightcode-engine was not found at C:/nope: set knightcode.engine_path", cx));
        let fs = FakeFs::new(cx.executor());
        let project = Project::test(fs, [], cx).await;
        let error = cx
            .update(|cx| {
                let delegate = AgentServerDelegate::new(project.read(cx).agent_server_store().clone(), None, None);
                KnightCodeAgentServer::new().connect(delegate, project.clone(), cx)
            })
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "knightcode-engine was not found at C:/nope: set knightcode.engine_path");
    }

    #[gpui::test]
    async fn the_wrapper_offers_oauth_logins_and_keeps_the_acp_downcast(cx: &mut TestAppContext) {
        init_test(cx);
        let engine = cx.update(|cx| Engine::failed_for_tests("unused", cx));
        let fs = FakeFs::new(cx.executor());
        let project = Project::test(fs, [], cx).await;
        let harness = connect_fake_acp_connection(project, cx).await;
        let connection: Rc<dyn AgentConnection> = Rc::new(KnightCodeConnection::new(harness.connection.clone(), engine, options()));

        let methods = connection.auth_methods();
        assert_eq!(methods.len(), 1, "API-key options are not panel buttons");
        assert_eq!(methods[0].id().0.as_ref(), "knightcode:anthropic");
        assert_eq!(methods[0].name(), "Anthropic (Claude Pro/Max)");
        assert!(connection.clone().downcast::<AcpConnection>().is_some());
        assert!(connection.downcast::<KnightCodeConnection>().is_none());
    }

    #[gpui::test]
    async fn authenticate_opens_the_url_the_engine_reports_and_completes(cx: &mut TestAppContext) {
        init_test(cx);
        let http = FakeHttpClient::create(|request| async move {
            let body = match request.uri().path() {
                "/v1/accounts/login" => r#"{"loginId":"L1"}"#,
                "/v1/accounts/login/L1" => r#"{"status":"complete","loginId":"L1","events":[{"type":"auth_url","url":"https://x/auth"}]}"#,
                _ => "{}",
            };
            Ok(Response::builder().status(200).body(AsyncBody::from(body)).unwrap())
        });
        let endpoint = Endpoint { url: "http://127.0.0.1:1".into(), token: "t".into() };
        let engine = cx.update(|cx| Engine::ready_for_tests(endpoint, http, cx));
        let fs = FakeFs::new(cx.executor());
        let project = Project::test(fs, [], cx).await;
        let harness = connect_fake_acp_connection(project, cx).await;
        let connection = KnightCodeConnection::new(harness.connection.clone(), engine, options());

        cx.update(|cx| connection.authenticate(acp::AuthMethodId::new("knightcode:anthropic"), cx)).await.unwrap();
        assert_eq!(cx.opened_url().as_deref(), Some("https://x/auth"));
    }

    #[test]
    fn no_code_path_can_reach_zeds_credential_provider() {
        // A crate cannot call what it does not link.
        let manifest = include_str!("../Cargo.toml");
        assert!(!manifest.contains("credentials_provider"));
        assert!(!manifest.contains("zed_credentials_provider"));
    }
}
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p knightcode_agent`
Expected: compile errors on the missing crate.

- [x] **Step 3: Write minimal implementation**

```toml
# crates/knightcode_agent/Cargo.toml
[package]
name = "knightcode_agent"
version = "0.1.0"
edition.workspace = true
publish = false
license = "GPL-3.0-or-later"

[lints]
workspace = true

[lib]
path = "src/knightcode_agent.rs"

[dependencies]
acp_thread.workspace = true
agent.workspace = true
agent-client-protocol.workspace = true
agent_servers.workspace = true
anyhow.workspace = true
collections.workspace = true
fs.workspace = true
futures.workspace = true
gpui.workspace = true
knightcode_engine.workspace = true
log.workspace = true
project.workspace = true
settings.workspace = true
task.workspace = true
ui.workspace = true
util.workspace = true

[dev-dependencies]
agent_servers = { workspace = true, features = ["test-support"] }
fs = { workspace = true, features = ["test-support"] }
gpui = { workspace = true, features = ["test-support"] }
http_client = { workspace = true, features = ["test-support"] }
knightcode_engine = { workspace = true, features = ["test-support"] }
project = { workspace = true, features = ["test-support"] }
settings = { workspace = true, features = ["test-support"] }
```

```rust
// crates/knightcode_agent/src/knightcode_agent.rs
//! Seam 1: KnightCode in the native agent's slot.
//!
//! The panel's built-in agent is whatever `Agent::NativeAgent` constructs.
//! This server keeps the native agent's id, so every persisted reference
//! (selected agent, thread rows, drafts) keeps working, and its `connect`
//! spawns `knightcode-engine acp --connect <url>` against the engine this
//! IDE started, through Zed's own `AcpConnection`. The token goes in the
//! child's environment, never on argv.

mod connection;

use acp_thread::AgentConnection;
use agent_client_protocol::schema::v1 as acp;
use agent_servers::{AcpConnection, AgentServer, AgentServerDelegate, CustomAgentServer};
use anyhow::{Context as _, Result};
use collections::{HashMap, HashSet};
use fs::Fs;
use gpui::{App, AppContext as _, Entity, Task};
use knightcode_engine::environment::TOKEN_ENV;
use project::{
    AgentId, Project,
    agent_server_store::{AgentServerCommand, AllAgentServersSettings, CustomAgentServerSettings},
};
use settings::{AgentConfigOptionValue, SettingsStore};
use std::{any::Any, path::Path, rc::Rc, sync::Arc};

pub use connection::KnightCodeConnection;

pub struct KnightCodeAgentServer {
    /// Mode, config-option and favourite defaults live under `agent_servers`
    /// keyed by agent id; `CustomAgentServer` already reads and writes them
    /// for any id, so it is reused for those six methods and nothing else.
    settings: CustomAgentServer,
}

impl Default for KnightCodeAgentServer {
    fn default() -> Self {
        Self::new()
    }
}

impl KnightCodeAgentServer {
    pub fn new() -> Self {
        Self { settings: CustomAgentServer::new(agent::ZED_AGENT_ID.clone()) }
    }
}

fn default_config_options(agent_id: &AgentId, cx: &App) -> HashMap<String, AgentConfigOptionValue> {
    cx.read_global(|settings: &SettingsStore, _| {
        settings
            .get::<AllAgentServersSettings>(None)
            .get(agent_id.as_ref())
            .map(|settings| match settings {
                CustomAgentServerSettings::Custom { default_config_options, .. }
                | CustomAgentServerSettings::Registry { default_config_options, .. } => default_config_options.clone(),
            })
            .unwrap_or_default()
    })
}

impl AgentServer for KnightCodeAgentServer {
    fn agent_id(&self) -> AgentId {
        agent::ZED_AGENT_ID.clone()
    }

    fn logo(&self) -> ui::IconName {
        ui::IconName::ZedAgent
    }

    fn connect(
        &self,
        _delegate: AgentServerDelegate,
        project: Entity<Project>,
        cx: &mut App,
    ) -> Task<Result<Rc<dyn AgentConnection>>> {
        let agent_id = self.agent_id();
        let default_mode = self.settings.default_mode(cx);
        let default_config_options = default_config_options(&agent_id, cx);
        let engine = knightcode_engine::global(cx);
        let store = project.read(cx).agent_server_store().downgrade();

        cx.spawn(async move |cx| {
            // Not until the engine is ready: the adapter's token must be one
            // the engine has already accepted, so the panel's auth_required
            // means "no credential", never "wrong token".
            let endpoint = engine.update(cx, |engine, cx| engine.ready(cx))?.await?;
            let (binary, client) = engine.read_with(cx, |engine, _| (engine.binary().map(Path::to_path_buf), engine.client()))?;
            let binary = binary.context("the engine is attached over the network; the agent panel needs a local knightcode-engine")?;
            let login_options = client.context("the engine is not ready")?.accounts().await?.login_options;

            let mut env = HashMap::default();
            env.insert(TOKEN_ENV.to_owned(), endpoint.token.to_string());
            let command = AgentServerCommand {
                path: binary,
                args: vec!["acp".into(), "--connect".into(), endpoint.url.clone()],
                env: Some(env),
            };
            let connection = AcpConnection::stdio(agent_id, project, command, store, default_mode, default_config_options, cx).await?;
            Ok(Rc::new(KnightCodeConnection::new(Rc::new(connection), engine, login_options)) as Rc<dyn AgentConnection>)
        })
    }

    fn into_any(self: Rc<Self>) -> Rc<dyn Any> {
        self
    }

    fn default_mode(&self, cx: &App) -> Option<acp::SessionModeId> {
        self.settings.default_mode(cx)
    }

    fn set_default_mode(&self, mode_id: Option<acp::SessionModeId>, fs: Arc<dyn Fs>, cx: &mut App) {
        self.settings.set_default_mode(mode_id, fs, cx)
    }

    fn default_config_option(&self, config_id: &str, cx: &App) -> Option<AgentConfigOptionValue> {
        self.settings.default_config_option(config_id, cx)
    }

    fn set_default_config_option(&self, config_id: &str, value: Option<AgentConfigOptionValue>, fs: Arc<dyn Fs>, cx: &mut App) {
        self.settings.set_default_config_option(config_id, value, fs, cx)
    }

    fn favorite_config_option_value_ids(&self, config_id: &acp::SessionConfigId, cx: &mut App) -> HashSet<acp::SessionConfigValueId> {
        self.settings.favorite_config_option_value_ids(config_id, cx)
    }

    fn toggle_favorite_config_option_value(
        &self,
        config_id: acp::SessionConfigId,
        value_id: acp::SessionConfigValueId,
        should_be_favorite: bool,
        fs: Arc<dyn Fs>,
        cx: &App,
    ) {
        self.settings.toggle_favorite_config_option_value(config_id, value_id, should_be_favorite, fs, cx)
    }
}
```

```rust
// crates/knightcode_agent/src/connection.rs
//! `AcpConnection`, with the engine's sign-in in front of it.
//!
//! When `session/new` fails with auth_required the panel offers one button
//! per `auth_methods()` and calls `authenticate` for the one clicked. The
//! adapter's own method is a no-op, so this wrapper offers the engine's
//! OAuth login options instead and drives the login from the IDE: start it,
//! open the URL the engine reports, poll until it completes. Every other
//! method delegates, and `into_any` hands back the inner connection so the
//! one place that downcasts to `AcpConnection` — the ACP log — still finds
//! it.

use acp_thread::{AcpThread, AgentConnection, AgentModelSelector, AgentSessionClientUserMessageIds, AgentSessionConfigOptions, AgentSessionList, AgentSessionModes, AgentSessionRetry, AgentSessionSetTitle, AgentSessionTruncate, AgentTelemetry, ElicitationStore};
use agent_client_protocol::schema::v1 as acp;
use agent_servers::AcpConnection;
use anyhow::{Result, anyhow};
use futures::{StreamExt as _, channel::mpsc};
use gpui::{App, AppContext as _, Entity, SharedString, Task};
use knightcode_engine::{Engine, LoginKind, LoginOption, login::{Login, LoginOutcome}, client::LoginEvent};
use project::{AgentId, Project};
use std::{any::Any, rc::Rc};
use task::SpawnInTerminal;
use util::path_list::PathList;

pub struct KnightCodeConnection {
    inner: Rc<AcpConnection>,
    engine: Entity<Engine>,
    options: Vec<LoginOption>,
    methods: Vec<acp::AuthMethod>,
}

impl KnightCodeConnection {
    pub fn new(inner: Rc<AcpConnection>, engine: Entity<Engine>, login_options: Vec<LoginOption>) -> Self {
        // API-key logins need a typed value; those live in Settings > AI.
        let options: Vec<LoginOption> = login_options.into_iter().filter(|option| option.kind == LoginKind::Oauth).collect();
        let methods = options
            .iter()
            .map(|option| {
                acp::AuthMethod::Agent(
                    acp::AuthMethodAgent::new(Self::method_id(option), option.label.clone())
                        .description(format!("Sign in to {} in your browser", option.provider_name)),
                )
            })
            .collect();
        Self { inner, engine, options, methods }
    }

    pub fn method_id(option: &LoginOption) -> String {
        format!("knightcode:{}", option.provider_id)
    }
}

impl AgentConnection for KnightCodeConnection {
    fn agent_id(&self) -> AgentId {
        self.inner.agent_id()
    }

    fn telemetry_id(&self) -> SharedString {
        self.inner.telemetry_id()
    }

    fn agent_version(&self) -> Option<SharedString> {
        self.inner.agent_version()
    }

    fn new_session(self: Rc<Self>, project: Entity<Project>, work_dirs: PathList, cx: &mut App) -> Task<Result<Entity<AcpThread>>> {
        self.inner.clone().new_session(project, work_dirs, cx)
    }

    fn supports_load_session(&self) -> bool {
        self.inner.supports_load_session()
    }

    fn load_session(self: Rc<Self>, session_id: acp::SessionId, project: Entity<Project>, work_dirs: PathList, title: Option<SharedString>, cx: &mut App) -> Task<Result<Entity<AcpThread>>> {
        self.inner.clone().load_session(session_id, project, work_dirs, title, cx)
    }

    fn supports_close_session(&self) -> bool {
        self.inner.supports_close_session()
    }

    fn close_session(self: Rc<Self>, session_id: &acp::SessionId, cx: &mut App) -> Task<Result<()>> {
        self.inner.clone().close_session(session_id, cx)
    }

    fn supports_resume_session(&self) -> bool {
        self.inner.supports_resume_session()
    }

    fn resume_session(self: Rc<Self>, session_id: acp::SessionId, project: Entity<Project>, work_dirs: PathList, title: Option<SharedString>, cx: &mut App) -> Task<Result<Entity<AcpThread>>> {
        self.inner.clone().resume_session(session_id, project, work_dirs, title, cx)
    }

    fn supports_session_history(&self) -> bool {
        self.inner.supports_session_history()
    }

    fn supports_session_additional_directories(&self) -> bool {
        self.inner.supports_session_additional_directories()
    }

    fn auth_methods(&self) -> &[acp::AuthMethod] {
        &self.methods
    }

    fn terminal_auth_task(&self, _method: &acp::AuthMethodId, _cx: &App) -> Option<Task<Result<SpawnInTerminal>>> {
        None
    }

    fn authenticate(&self, method: acp::AuthMethodId, cx: &mut App) -> Task<Result<()>> {
        let Some(option) = self.options.iter().find(|option| Self::method_id(option) == method.0.as_ref()).cloned() else {
            return Task::ready(Err(anyhow!("unknown sign-in method {}", method.0)));
        };
        let Some(client) = self.engine.read(cx).client() else {
            return Task::ready(Err(anyhow!("the engine is not running")));
        };
        cx.spawn(async move |cx| {
            let mut login = Login::start(client, &option.provider_id, option.kind).await?;
            // The login polls in the background and reports events here, where
            // the browser can be opened. Zed shows its own spinner meanwhile.
            let (tx, mut rx) = mpsc::unbounded::<LoginEvent>();
            let polling = cx.background_spawn(async move {
                let outcome = login.advance(|event| {
                    tx.unbounded_send(event.clone()).ok();
                }).await;
                (login, outcome)
            });
            while let Some(event) = rx.next().await {
                match event {
                    LoginEvent::AuthUrl { url, .. } => cx.update(|cx| cx.open_url(&url)),
                    LoginEvent::DeviceCode { user_code, verification_uri } => {
                        log::info!("knightcode: enter code {user_code} at {verification_uri}");
                        cx.update(|cx| cx.open_url(&verification_uri));
                    }
                    LoginEvent::Info { .. } | LoginEvent::Progress { .. } => {}
                }
            }
            let (login, outcome) = polling.await;
            match outcome? {
                LoginOutcome::Complete => Ok(()),
                LoginOutcome::Prompt(_) => {
                    login.cancel().await.ok();
                    Err(anyhow!("this sign-in needs a value typed in; open Settings > AI > KnightCode to finish it"))
                }
            }
        })
    }

    fn supports_logout(&self) -> bool {
        self.inner.supports_logout()
    }

    fn logout(&self, cx: &mut App) -> Task<Result<()>> {
        self.inner.logout(cx)
    }

    fn client_user_message_ids(&self, cx: &App) -> Option<Rc<dyn AgentSessionClientUserMessageIds>> {
        self.inner.client_user_message_ids(cx)
    }

    fn prompt(&self, params: acp::PromptRequest, cx: &mut App) -> Task<Result<acp::PromptResponse>> {
        self.inner.prompt(params, cx)
    }

    fn retry(&self, session_id: &acp::SessionId, cx: &App) -> Option<Rc<dyn AgentSessionRetry>> {
        self.inner.retry(session_id, cx)
    }

    fn cancel(&self, session_id: &acp::SessionId, cx: &mut App) {
        self.inner.cancel(session_id, cx)
    }

    fn request_elicitations(&self) -> Option<Entity<ElicitationStore>> {
        self.inner.request_elicitations()
    }

    fn truncate(&self, session_id: &acp::SessionId, cx: &App) -> Option<Rc<dyn AgentSessionTruncate>> {
        self.inner.truncate(session_id, cx)
    }

    fn set_title(&self, session_id: &acp::SessionId, cx: &App) -> Option<Rc<dyn AgentSessionSetTitle>> {
        self.inner.set_title(session_id, cx)
    }

    fn model_selector(&self, session_id: &acp::SessionId) -> Option<Rc<dyn AgentModelSelector>> {
        self.inner.model_selector(session_id)
    }

    fn telemetry(&self) -> Option<Rc<dyn AgentTelemetry>> {
        self.inner.telemetry()
    }

    fn session_modes(&self, session_id: &acp::SessionId, cx: &App) -> Option<Rc<dyn AgentSessionModes>> {
        self.inner.session_modes(session_id, cx)
    }

    fn session_config_options(&self, session_id: &acp::SessionId, cx: &App) -> Option<Rc<dyn AgentSessionConfigOptions>> {
        self.inner.session_config_options(session_id, cx)
    }

    fn session_list(&self, cx: &mut App) -> Option<Rc<dyn AgentSessionList>> {
        self.inner.session_list(cx)
    }

    /// The inner connection, so `downcast::<AcpConnection>()` succeeds
    /// through the wrapper and the ACP log keeps working.
    fn into_any(self: Rc<Self>) -> Rc<dyn Any> {
        self.inner.clone()
    }
}
```

The trait method list is copied from `connection.rs` 91–260 at the base
commit; when a merge adds a method with a default, the wrapper must add
the delegation too, or the default silently disables the feature for
KnightCode. Record that in the fork README's merge procedure.

In `crates/agent_ui/src/agent_ui.rs`, `Agent::server`:

```rust
            Self::NativeAgent => Rc::new(knightcode_agent::KnightCodeAgentServer::new()),
```

and the now-unused parameters become `_fs` and `_thread_store`. Add
`knightcode_agent.workspace = true` to `crates/agent_ui/Cargo.toml`, the
member and the workspace dependency to the root `Cargo.toml`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p knightcode_agent`, then `cargo build -p agent_ui`.
Expected: PASS, 4 tests; `agent_ui` builds with no new warnings.

- [ ] **Step 5: Validate in the running IDE**

Once the engine binary is rebuilt (ask first), `cargo run -p zed` with
`KNIGHTCODE_ENGINE_PATH` set to the absolute path of
`packages/cli-win32-x64/bin/knightcode-engine.exe`, open this checkout as
the project, open the agent panel. Before signing in (`knightcode
auth` state does not matter; the IDE and the CLI share `auth.json`, so
sign out in the CLI first to test the empty state): the panel shows
"Authenticate to KnightCode" with one button per OAuth provider; clicking
"Anthropic (Claude Pro/Max)" opens the browser, the panel spins, and after
the browser finishes the panel creates a session. Then the three WP02
scenarios (multi-file edit under review, shell command in a terminal,
mid-turn cancel) against the fork. Record in Validation.

- [x] **Step 6: Commit**

```bash
git add Cargo.toml Cargo.lock crates/knightcode_agent crates/agent_ui/Cargo.toml crates/agent_ui/src/agent_ui.rs
git commit -m "feat(knightcode_agent): put KnightCode in the agent panel's native slot"
```

---

## Task 5: `knightcode_models` — seam 2 and the sign-in view

**Files (fork):**
- Create: `crates/knightcode_models/Cargo.toml`, `src/knightcode_models.rs`,
  `src/state.rs`, `src/request.rs`, `src/model.rs`, `src/sign_in.rs`
- Modify: `Cargo.toml` (member, workspace dependency),
  `crates/language_models/Cargo.toml` (one dependency),
  `crates/language_models/src/language_models.rs` (registration body,
  unused imports)

**Interfaces:**
- Consumes: `language_model::{LanguageModel, LanguageModelProvider, LanguageModelProviderState, ProviderSettingsView, InlineProviderSettings, AuthenticateError, LanguageModelCompletionError, LanguageModelCompletionEvent, LanguageModelRequest, RateLimiter, stream_in_background, chat_completion::ChatCompletionEventMapper}`,
  `open_ai::{Request, RequestMessage, MessageContent, StreamOptions, stream_completion}`,
  `http_client::CustomHeaders`, `ui_input::InputField`,
  `knightcode_engine::{Engine, EngineEvent, client::{Account, EngineModel, LoginEvent, LoginOption, PendingPrompt, PromptKind}, login::{Login, LoginOutcome}}`.
- Produces:
  - `pub fn provider_id() -> LanguageModelProviderId` (`"knightcode"`).
  - `pub struct KnightCodeLanguageModelProvider` with `pub fn new(cx: &mut App) -> Self`,
    `impl LanguageModelProviderState<ObservableEntity = State>`, `impl LanguageModelProvider`.
  - `state.rs`: `pub struct State { pub accounts: Vec<Account>, pub login_options: Vec<LoginOption>, pub models: Vec<EngineModel>, pub login: Option<ActiveLogin>, .. }`,
    `pub struct ActiveLogin { pub option: LoginOption, pub step: LoginStep, .. }`,
    `pub enum LoginStep { Starting, Browser(String), DeviceCode { code: String, url: String }, Prompt(PendingPrompt), Failed(String) }`,
    `impl State { pub fn new(engine: Entity<Engine>, cx: &mut Context<Self>) -> Self; pub fn refresh(&mut self, cx) -> Task<Result<(), AuthenticateError>>; pub fn start_login(&mut self, option: LoginOption, cx); pub fn submit_prompt(&mut self, value: String, cx); pub fn cancel_login(&mut self, cx); pub fn sign_out(&mut self, provider_id: String, cx); pub fn default_model(&self) -> Option<&EngineModel> }`.
  - `request.rs`: `pub fn to_request(request: LanguageModelRequest, model: &str) -> open_ai::Request` (pure).
  - `model.rs`: `pub struct KnightCodeLanguageModel` with `impl LanguageModel`.
  - `sign_in.rs`: `pub struct SignInView` with `pub fn new(state: Entity<State>, window: &mut Window, cx: &mut Context<Self>) -> Self`, `impl Render`.

`authenticate` never opens a browser: Zed calls it for every provider at
startup and on the first Cmd+K (`agent.rs` 361–366, `inline_assistant.rs`
263–268). The interactive login is `State::start_login`, reached from the
sign-in view's buttons and, for OAuth, from the panel wrapper. API keys
are the same flow: the engine answers an `api_key` login with a `secret`
prompt (`accounts.ts` 187–200), which the view renders as one input.

- [x] **Step 1: Write the failing tests**

```rust
// crates/knightcode_models/src/request.rs (tests module)
#[cfg(test)]
mod tests {
    use super::*;
    use language_model::{LanguageModelRequestMessage, MessageContent, Role};

    fn message(role: Role, content: Vec<MessageContent>) -> LanguageModelRequestMessage {
        LanguageModelRequestMessage { role, content, cache: false, reasoning_details: None }
    }

    #[test]
    fn roles_map_text_flattens_and_non_text_is_dropped() {
        let request = LanguageModelRequest {
            messages: vec![
                message(Role::System, vec![MessageContent::Text("You edit code.".into())]),
                message(Role::User, vec![MessageContent::Text("Rename ".into()), MessageContent::Text("greet".into())]),
                message(Role::Assistant, vec![MessageContent::Text("Done.".into())]),
                message(Role::User, vec![MessageContent::RedactedThinking("x".into())]),
            ],
            temperature: Some(0.2),
            stop: vec!["END".into()],
            ..Default::default()
        };
        let converted = to_request(request, "anthropic/claude-opus-5");
        assert_eq!(converted.model, "anthropic/claude-opus-5");
        assert!(converted.stream);
        assert_eq!(converted.temperature, Some(0.2));
        assert_eq!(converted.stop, vec!["END".to_string()]);
        assert_eq!(converted.messages.len(), 3, "a message with no text is not sent");
        assert!(matches!(&converted.messages[0], open_ai::RequestMessage::System { content: open_ai::MessageContent::Plain(text) } if text == "You edit code."));
        assert!(matches!(&converted.messages[1], open_ai::RequestMessage::User { content: open_ai::MessageContent::Plain(text) } if text == "Rename greet"));
        assert!(matches!(&converted.messages[2], open_ai::RequestMessage::Assistant { content: Some(open_ai::MessageContent::Plain(text)), .. } if text == "Done."));
        assert!(converted.tools.is_empty());
        assert_eq!(serde_json::to_value(&converted).unwrap().get("tools"), None, "no tools key on the wire");
    }
}
```

```rust
// crates/knightcode_models/src/knightcode_models.rs (tests module)
#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use http_client::{AsyncBody, FakeHttpClient, Response};
    use knightcode_engine::{Endpoint, Engine};
    use language_model::{AuthenticateError, LanguageModelProvider as _};
    use settings::SettingsStore;
    use std::sync::{Arc, Mutex};

    const NO_ACCOUNTS: &str = r#"{"accounts":[],"loginOptions":[{"providerId":"anthropic","providerName":"Anthropic","type":"oauth","label":"Anthropic (Claude Pro/Max)","isSubscription":true}]}"#;
    const ONE_ACCOUNT: &str = r#"{"accounts":[{"providerId":"anthropic","providerName":"Anthropic","type":"oauth","isSubscription":true}],"loginOptions":[]}"#;
    const NO_MODELS: &str = r#"{"models":[]}"#;
    const TWO_MODELS: &str = r#"{"models":[{"ref":"anthropic/claude-opus-5","id":"claude-opus-5","providerId":"anthropic","providerName":"Anthropic","name":"Claude Opus 5","contextWindow":200000,"maxTokens":32000,"reasoning":true,"input":["text","image"],"cost":{}},{"ref":"agentrouter/claude-opus-5","id":"claude-opus-5","providerId":"agentrouter","providerName":"AgentRouter","name":"Claude Opus 5","contextWindow":200000,"maxTokens":32000,"reasoning":true,"input":["text"],"cost":{}}]}"#;

    /// A fake engine whose accounts and models can be swapped mid-test.
    fn engine(cx: &mut TestAppContext, accounts: &'static str, models: &'static str) -> (gpui::Entity<Engine>, Arc<Mutex<(&'static str, &'static str)>>) {
        let bodies = Arc::new(Mutex::new((accounts, models)));
        let http = FakeHttpClient::create({
            let bodies = bodies.clone();
            move |request| {
                let bodies = bodies.clone();
                let path = request.uri().path().to_string();
                async move {
                    let (accounts, models) = *bodies.lock().unwrap();
                    let body = match path.as_str() {
                        "/v1/accounts" => accounts,
                        "/v1/models" => models,
                        "/v1/accounts/login" => r#"{"loginId":"L1"}"#,
                        "/v1/accounts/login/L1" => r#"{"status":"complete","loginId":"L1","events":[{"type":"auth_url","url":"https://x/auth"}]}"#,
                        _ => "{}",
                    };
                    Ok(Response::builder().status(200).body(AsyncBody::from(body)).unwrap())
                }
            }
        });
        cx.update(|cx| {
            let settings_store = SettingsStore::test(cx);
            cx.set_global(settings_store);
            cx.set_http_client(http.clone());
        });
        let endpoint = Endpoint { url: "http://127.0.0.1:1".into(), token: "t".into() };
        (cx.update(|cx| Engine::ready_for_tests(endpoint, http, cx)), bodies)
    }

    #[gpui::test]
    async fn unauthenticated_with_no_credential_and_no_key_prompt(cx: &mut TestAppContext) {
        let (_engine, _) = engine(cx, NO_ACCOUNTS, NO_MODELS);
        let provider = cx.update(KnightCodeLanguageModelProvider::new);
        let error = cx.update(|cx| provider.authenticate(cx)).await.unwrap_err();
        assert!(matches!(error, AuthenticateError::CredentialsNotFound), "{error}");
        cx.read(|cx| {
            assert!(!provider.is_authenticated(cx));
            assert!(provider.provided_models(cx).is_empty());
            assert!(matches!(provider.settings_view(cx), Some(ProviderSettingsView::Inline(_))), "a sign-in view, not an API-key form");
        });
        assert!(cx.opened_url().is_none(), "authenticate never opens a browser");
    }

    #[gpui::test]
    async fn authenticated_models_are_qualified_and_disambiguated(cx: &mut TestAppContext) {
        let (_engine, _) = engine(cx, ONE_ACCOUNT, TWO_MODELS);
        let provider = cx.update(KnightCodeLanguageModelProvider::new);
        cx.update(|cx| provider.authenticate(cx)).await.unwrap();
        cx.read(|cx| {
            assert!(provider.is_authenticated(cx));
            let models = provider.provided_models(cx);
            assert_eq!(models.len(), 2);
            assert_eq!(models[0].id().0.as_ref(), "anthropic/claude-opus-5");
            assert_eq!(models[1].id().0.as_ref(), "agentrouter/claude-opus-5");
            assert_ne!(models[0].name(), models[1].name());
            assert_eq!(models[0].max_token_count(), 200_000);
            assert!(models[0].supports_images() && !models[1].supports_images());
            assert!(!models[0].supports_tools());
            assert_eq!(provider.default_model(cx).unwrap().id(), models[0].id());
        });
    }

    #[gpui::test]
    async fn a_login_opens_the_browser_then_refreshes(cx: &mut TestAppContext) {
        let (_engine, bodies) = engine(cx, NO_ACCOUNTS, NO_MODELS);
        let provider = cx.update(KnightCodeLanguageModelProvider::new);
        cx.update(|cx| provider.authenticate(cx)).await.unwrap_err();
        let option = cx.read(|cx| provider.state.read(cx).login_options[0].clone());
        *bodies.lock().unwrap() = (ONE_ACCOUNT, TWO_MODELS);
        cx.update(|cx| provider.state.update(cx, |state, cx| state.start_login(option, cx)));
        cx.run_until_parked();
        assert_eq!(cx.opened_url().as_deref(), Some("https://x/auth"));
        cx.read(|cx| {
            assert!(provider.state.read(cx).login.is_none(), "a completed login clears the progress");
            assert!(provider.is_authenticated(cx));
        });
    }

    #[test]
    fn no_code_path_can_reach_zeds_credential_provider() {
        let manifest = include_str!("../Cargo.toml");
        assert!(!manifest.contains("credentials_provider"));
    }
}
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p knightcode_models`
Expected: compile errors on the missing crate.

- [x] **Step 3: Write minimal implementation**

```toml
# crates/knightcode_models/Cargo.toml
[package]
name = "knightcode_models"
version = "0.1.0"
edition.workspace = true
publish = false
license = "GPL-3.0-or-later"

[lints]
workspace = true

[lib]
path = "src/knightcode_models.rs"

[dependencies]
anyhow.workspace = true
edit_prediction.workspace = true
edit_prediction_types.workspace = true
futures.workspace = true
gpui.workspace = true
http_client.workspace = true
icons.workspace = true
knightcode_engine.workspace = true
language.workspace = true
language_model.workspace = true
log.workspace = true
open_ai.workspace = true
serde_json.workspace = true
settings.workspace = true
text.workspace = true
ui.workspace = true
ui_input.workspace = true
zeta_prompt.workspace = true

[dev-dependencies]
gpui = { workspace = true, features = ["test-support"] }
http_client = { workspace = true, features = ["test-support"] }
knightcode_engine = { workspace = true, features = ["test-support"] }
language_model = { workspace = true, features = ["test-support"] }
settings = { workspace = true, features = ["test-support"] }
```

(`edit_prediction`, `edit_prediction_types`, `language`, `text`,
`zeta_prompt`, `icons` are for Task 6's delegate; add them there if the
reviewer prefers the manifest to grow with its task.)

```rust
// crates/knightcode_models/src/request.rs
//! `LanguageModelRequest` to the engine's chat-completions request. The
//! engine accepts system, user and assistant messages with string content
//! and nothing else, which is what every seam-2 surface sends.

use language_model::{LanguageModelRequest, Role};
use open_ai::{MessageContent, Request, RequestMessage, StreamOptions};

pub fn to_request(request: LanguageModelRequest, model: &str) -> Request {
    let messages = request
        .messages
        .iter()
        .filter_map(|message| {
            let text = message.string_contents();
            if text.is_empty() {
                return None;
            }
            let content = MessageContent::Plain(text);
            Some(match message.role {
                Role::System => RequestMessage::System { content },
                Role::User => RequestMessage::User { content },
                Role::Assistant => RequestMessage::Assistant {
                    content: Some(content),
                    tool_calls: Vec::new(),
                    reasoning_content: None,
                    reasoning_details: None,
                },
            })
        })
        .collect();
    Request {
        model: model.to_owned(),
        messages,
        stream: true,
        stream_options: Some(StreamOptions { include_usage: true }),
        max_completion_tokens: None,
        max_tokens: None,
        stop: request.stop,
        temperature: request.temperature,
        tool_choice: None,
        parallel_tool_calls: None,
        tools: Vec::new(),
        prompt_cache_key: None,
        reasoning_effort: None,
        service_tier: None,
    }
}
```

```rust
// crates/knightcode_models/src/state.rs
//! What the provider knows: the engine's accounts, login options and
//! models, and the login in progress. Refreshed from the engine on demand
//! and whenever the engine reports a change; never a credential.

use anyhow::anyhow;
use futures::{StreamExt as _, channel::mpsc};
use gpui::{App, AppContext as _, Context, Entity, Subscription, Task};
use knightcode_engine::{
    Engine, EngineEvent,
    client::{Account, EngineModel, LoginEvent, LoginOption, PendingPrompt},
    login::{Login, LoginOutcome},
};
use language_model::AuthenticateError;

pub enum LoginStep {
    Starting,
    Browser(String),
    DeviceCode { code: String, url: String },
    Prompt(PendingPrompt),
    Failed(String),
}

pub struct ActiveLogin {
    pub option: LoginOption,
    pub step: LoginStep,
    /// The login, parked while the user answers a prompt.
    parked: Option<Login>,
    _task: Option<Task<()>>,
}

pub struct State {
    engine: Entity<Engine>,
    pub accounts: Vec<Account>,
    pub login_options: Vec<LoginOption>,
    pub models: Vec<EngineModel>,
    pub login: Option<ActiveLogin>,
    refresh: Option<Task<()>>,
    _subscription: Subscription,
}

impl State {
    pub fn new(engine: Entity<Engine>, cx: &mut Context<Self>) -> Self {
        let subscription = cx.subscribe(&engine, |this, _, event, cx| match event {
            EngineEvent::Ready(_) | EngineEvent::AccountChanged { .. } | EngineEvent::ModelsChanged => {
                this.refresh_quietly(cx);
            }
            EngineEvent::Stopped => {
                this.models.clear();
                cx.notify();
            }
            EngineEvent::Failed(_) => {}
        });
        Self {
            engine,
            accounts: Vec::new(),
            login_options: Vec::new(),
            models: Vec::new(),
            login: None,
            refresh: None,
            _subscription: subscription,
        }
    }

    pub fn default_model(&self) -> Option<&EngineModel> {
        self.models.first()
    }

    /// Non-interactive. `CredentialsNotFound` when the engine has nothing
    /// to offer; `ConnectionRefused` while it is still starting.
    pub fn refresh(&mut self, cx: &mut Context<Self>) -> Task<Result<(), AuthenticateError>> {
        let Some(client) = self.engine.read(cx).client() else {
            return Task::ready(Err(AuthenticateError::ConnectionRefused));
        };
        cx.spawn(async move |this, cx| {
            let accounts = client.accounts().await.map_err(|error| AuthenticateError::Other(anyhow!(error)))?;
            let models = client.models().await.map_err(|error| AuthenticateError::Other(anyhow!(error)))?;
            let empty = models.is_empty();
            this.update(cx, |this, cx| {
                this.accounts = accounts.accounts;
                this.login_options = accounts.login_options;
                this.models = models;
                cx.notify();
            })
            .map_err(|error| AuthenticateError::Other(error))?;
            if empty { Err(AuthenticateError::CredentialsNotFound) } else { Ok(()) }
        })
    }

    pub fn start_login(&mut self, option: LoginOption, cx: &mut Context<Self>) {
        let Some(client) = self.engine.read(cx).client() else {
            self.login = Some(ActiveLogin { option, step: LoginStep::Failed("the engine is not running".into()), parked: None, _task: None });
            cx.notify();
            return;
        };
        let (provider_id, kind) = (option.provider_id.clone(), option.kind);
        self.login = Some(ActiveLogin { option, step: LoginStep::Starting, parked: None, _task: None });
        cx.notify();
        let task = cx.spawn(async move |this, cx| {
            match Login::start(client, &provider_id, kind).await {
                Ok(login) => this.update(cx, |this, cx| this.drive(login, cx)).ok(),
                Err(error) => this.update(cx, |this, cx| this.fail(error.to_string(), cx)).ok(),
            };
        });
        if let Some(login) = &mut self.login {
            login._task = Some(task);
        }
    }

    pub fn submit_prompt(&mut self, value: String, cx: &mut Context<Self>) {
        let Some(login) = self.login.as_mut().and_then(|active| active.parked.take()) else {
            return;
        };
        if let Some(active) = &mut self.login {
            active.step = LoginStep::Starting;
        }
        cx.notify();
        let task = cx.spawn(async move |this, cx| {
            match login.submit(&value).await {
                Ok(()) => this.update(cx, |this, cx| this.drive(login, cx)).ok(),
                Err(error) => this.update(cx, |this, cx| this.fail(error.to_string(), cx)).ok(),
            };
        });
        if let Some(active) = &mut self.login {
            active._task = Some(task);
        }
    }

    pub fn cancel_login(&mut self, cx: &mut Context<Self>) {
        if let Some(active) = self.login.take()
            && let Some(login) = active.parked
        {
            cx.background_spawn(async move {
                login.cancel().await.ok();
            })
            .detach();
        }
        cx.notify();
    }

    pub fn sign_out(&mut self, provider_id: String, cx: &mut Context<Self>) {
        let Some(client) = self.engine.read(cx).client() else {
            return;
        };
        cx.spawn(async move |this, cx| {
            if let Err(error) = client.sign_out(&provider_id).await {
                log::warn!("knightcode: sign out of {provider_id} failed: {error}");
            }
            // The engine also emits account.changed; refreshing here makes the
            // view current even if that event is lost.
            this.update(cx, |this, cx| {
                this.refresh_quietly(cx);
            })
            .ok();
        })
        .detach();
    }

    fn fail(&mut self, reason: String, cx: &mut Context<Self>) {
        if let Some(active) = &mut self.login {
            active.step = LoginStep::Failed(reason);
            active.parked = None;
        }
        cx.notify();
    }

    /// Poll the login in the background, reflect each event in `step`, open
    /// the browser when the engine reports a URL, and end complete (refresh)
    /// or parked on a prompt.
    fn drive(&mut self, mut login: Login, cx: &mut Context<Self>) {
        let (tx, mut rx) = mpsc::unbounded::<LoginEvent>();
        let polling = cx.background_spawn(async move {
            let outcome = login.advance(|event| {
                tx.unbounded_send(event.clone()).ok();
            }).await;
            (login, outcome)
        });
        let task = cx.spawn(async move |this, cx| {
            while let Some(event) = rx.next().await {
                this.update(cx, |this, cx| {
                    let Some(active) = &mut this.login else {
                        return;
                    };
                    match event {
                        LoginEvent::AuthUrl { url, .. } => {
                            cx.open_url(&url);
                            active.step = LoginStep::Browser(url);
                        }
                        LoginEvent::DeviceCode { user_code, verification_uri } => {
                            cx.open_url(&verification_uri);
                            active.step = LoginStep::DeviceCode { code: user_code, url: verification_uri };
                        }
                        LoginEvent::Info { .. } | LoginEvent::Progress { .. } => {}
                    }
                    cx.notify();
                })
                .ok();
            }
            let (login, outcome) = polling.await;
            this.update(cx, |this, cx| match outcome {
                Ok(LoginOutcome::Complete) => {
                    this.login = None;
                    this.refresh_quietly(cx);
                    cx.notify();
                }
                Ok(LoginOutcome::Prompt(prompt)) => {
                    if let Some(active) = &mut this.login {
                        active.step = LoginStep::Prompt(prompt);
                        active.parked = Some(login);
                    }
                    cx.notify();
                }
                Err(error) => this.fail(error.to_string(), cx),
            })
            .ok();
        });
        if let Some(active) = &mut self.login {
            active._task = Some(task);
        }
    }
}
```

`refresh_quietly` is the background form of `refresh`, for the event
subscription and the post-login and post-sign-out paths, where nobody
awaits the outcome:

```rust
    fn refresh_quietly(&mut self, cx: &mut Context<Self>) {
        let refresh = self.refresh(cx);
        self.refresh = Some(cx.spawn(async move |_, _| {
            refresh.await.ok();
        }));
    }
```

```rust
// crates/knightcode_models/src/model.rs
//! One engine model as a Zed `LanguageModel`. Requests go to the engine's
//! `/v1/chat/completions` with the launch token; the engine picks the
//! provider and the credential.

use anyhow::anyhow;
use futures::{FutureExt as _, StreamExt as _, future::BoxFuture, stream::BoxStream};
use gpui::{AsyncApp, Entity};
use http_client::{CustomHeaders, HttpClient};
use knightcode_engine::{Engine, client::EngineModel};
use language_model::{
    LanguageModel, LanguageModelCompletionError, LanguageModelCompletionEvent, LanguageModelId, LanguageModelName,
    LanguageModelProviderId, LanguageModelProviderName, LanguageModelRequest, LanguageModelToolChoice, RateLimiter,
    chat_completion::ChatCompletionEventMapper, stream_in_background,
};
use std::sync::Arc;

use crate::{provider_id, provider_name, request::to_request};

pub struct KnightCodeLanguageModel {
    pub(crate) model: EngineModel,
    pub(crate) engine: Entity<Engine>,
    pub(crate) http: Arc<dyn HttpClient>,
    pub(crate) request_limiter: RateLimiter,
}

impl LanguageModel for KnightCodeLanguageModel {
    fn id(&self) -> LanguageModelId {
        LanguageModelId::from(self.model.reference.clone())
    }

    fn name(&self) -> LanguageModelName {
        // Five providers may offer "Claude Opus 5"; the engine provider tells them apart.
        LanguageModelName::from(format!("{} ({})", self.model.name, self.model.provider_name))
    }

    fn provider_id(&self) -> LanguageModelProviderId {
        provider_id()
    }

    fn provider_name(&self) -> LanguageModelProviderName {
        provider_name()
    }

    fn telemetry_id(&self) -> String {
        format!("knightcode/{}", self.model.reference)
    }

    fn supports_images(&self) -> bool {
        self.model.input.iter().any(|input| input == "image")
    }

    fn supports_tools(&self) -> bool {
        false
    }

    fn supports_tool_choice(&self, choice: LanguageModelToolChoice) -> bool {
        matches!(choice, LanguageModelToolChoice::None)
    }

    fn max_token_count(&self) -> u64 {
        self.model.context_window
    }

    fn max_output_tokens(&self) -> Option<u64> {
        Some(self.model.max_tokens)
    }

    fn stream_completion(
        &self,
        request: LanguageModelRequest,
        cx: &AsyncApp,
    ) -> BoxFuture<'static, Result<BoxStream<'static, Result<LanguageModelCompletionEvent, LanguageModelCompletionError>>, LanguageModelCompletionError>> {
        let Some(endpoint) = self.engine.read_with(cx, |engine, _| engine.endpoint()) else {
            return async { Err(LanguageModelCompletionError::Other(anyhow!("the KnightCode engine is not running"))) }.boxed();
        };
        let request = to_request(request, &self.model.reference);
        let http = self.http.clone();
        let api_url = format!("{}/v1", endpoint.url);
        let token = endpoint.token.clone();
        let future = self.request_limiter.stream(async move {
            let events = open_ai::stream_completion(http.as_ref(), "KnightCode", &api_url, &token, request, &CustomHeaders::default()).await?;
            Ok(events)
        });
        let executor = cx.background_executor().clone();
        async move {
            let events = future.await?;
            Ok(stream_in_background(ChatCompletionEventMapper::new().map_stream(events.boxed()).boxed(), executor))
        }
        .boxed()
    }
}
```

```rust
// crates/knightcode_models/src/knightcode_models.rs
//! Seam 2: every non-panel AI surface — Cmd+K in a buffer, Cmd+K in the
//! terminal, commit messages, thread titles — served by the engine through
//! one `LanguageModelProvider`. The provider holds accounts and models it
//! read from the engine and never a credential; signing in is a login the
//! engine runs, driven from the view in `sign_in.rs`.

pub mod edit_prediction;
mod model;
mod request;
mod sign_in;
mod state;

use gpui::{App, AppContext as _, Entity, Task};
use language_model::{
    AuthenticateError, IconOrSvg, InlineDescription, InlineProviderSettings, LanguageModel, LanguageModelProvider,
    LanguageModelProviderId, LanguageModelProviderName, LanguageModelProviderState, ProviderSettingsView, RateLimiter,
};
use std::sync::Arc;
use ui::IconName;

pub use model::KnightCodeLanguageModel;
pub use sign_in::SignInView;
pub use state::{ActiveLogin, LoginStep, State};

pub fn provider_id() -> LanguageModelProviderId {
    LanguageModelProviderId::from("knightcode".to_string())
}

pub fn provider_name() -> LanguageModelProviderName {
    LanguageModelProviderName::from("KnightCode".to_string())
}

pub struct KnightCodeLanguageModelProvider {
    pub state: Entity<State>,
}

impl KnightCodeLanguageModelProvider {
    pub fn new(cx: &mut App) -> Self {
        let engine = knightcode_engine::global(cx);
        let state = cx.new(|cx| State::new(engine, cx));
        Self { state }
    }

    fn model(&self, model: &knightcode_engine::client::EngineModel, cx: &App) -> Arc<dyn LanguageModel> {
        let state = self.state.read(cx);
        Arc::new(KnightCodeLanguageModel {
            model: model.clone(),
            engine: state.engine(),
            http: cx.http_client(),
            request_limiter: RateLimiter::new(4),
        })
    }
}

impl LanguageModelProviderState for KnightCodeLanguageModelProvider {
    type ObservableEntity = State;

    fn observable_entity(&self) -> Option<Entity<Self::ObservableEntity>> {
        Some(self.state.clone())
    }
}

impl LanguageModelProvider for KnightCodeLanguageModelProvider {
    fn id(&self) -> LanguageModelProviderId {
        provider_id()
    }

    fn name(&self) -> LanguageModelProviderName {
        provider_name()
    }

    fn icon(&self) -> IconOrSvg {
        IconOrSvg::Icon(IconName::Sparkle)
    }

    fn default_model(&self, cx: &App) -> Option<Arc<dyn LanguageModel>> {
        let state = self.state.read(cx);
        state.default_model().map(|model| self.model(model, cx))
    }

    fn default_fast_model(&self, _cx: &App) -> Option<Arc<dyn LanguageModel>> {
        None
    }

    fn provided_models(&self, cx: &App) -> Vec<Arc<dyn LanguageModel>> {
        self.state.read(cx).models.iter().map(|model| self.model(model, cx)).collect()
    }

    fn is_authenticated(&self, cx: &App) -> bool {
        !self.state.read(cx).models.is_empty()
    }

    fn authenticate(&self, cx: &mut App) -> Task<Result<(), AuthenticateError>> {
        self.state.update(cx, |state, cx| state.refresh(cx))
    }

    fn settings_view(&self, cx: &mut App) -> Option<ProviderSettingsView> {
        let state = self.state.clone();
        let signed_in = self.is_authenticated(cx);
        Some(ProviderSettingsView::Inline(InlineProviderSettings {
            title: (!signed_in).then(|| "Sign in to KnightCode".into()),
            description: (!signed_in).then(|| InlineDescription::Text("One sign-in serves the agent panel, inline assist, commit messages and edit prediction. The KnightCode CLI shares it.".into())),
            create_view: Arc::new(move |window, cx| cx.new(|cx| SignInView::new(state.clone(), window, cx)).into()),
        }))
    }

    fn authentication_error_message(&self) -> ui::SharedString {
        "KnightCode's sign-in has expired. Sign in again under Settings > AI > KnightCode.".into()
    }

    fn missing_credentials_error_message(&self) -> ui::SharedString {
        "Sign in to KnightCode under Settings > AI > KnightCode to continue.".into()
    }
}
```

(`State` gains `pub fn engine(&self) -> Entity<Engine>` returning a
clone.)

```rust
// crates/knightcode_models/src/sign_in.rs
//! The provider's settings view: who is signed in, a button per login
//! option, and the login in progress — a URL the browser has been sent to,
//! a device code to type, or one input for the value the engine asked for.
//! Phase E turns this into the first-run screen; the state machine stays.

use gpui::{Context, Entity, Render, Subscription, Window};
use knightcode_engine::client::{LoginKind, PromptKind};
use ui::{Button, ButtonStyle, Label, LabelSize, ParentElement as _, Styled as _, h_flex, prelude::*, v_flex};
use ui_input::InputField;

use crate::state::{LoginStep, State};

pub struct SignInView {
    state: Entity<State>,
    input: Entity<InputField>,
    _subscription: Subscription,
}

impl SignInView {
    pub fn new(state: Entity<State>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| InputField::new(window, cx, "").masked(true));
        let subscription = cx.observe(&state, |_, _, cx| cx.notify());
        Self { state, input, _subscription: subscription }
    }
}

impl Render for SignInView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let state = self.state.read(cx);
        let mut root = v_flex().gap_2();

        for account in &state.accounts {
            let provider_id = account.provider_id.clone();
            let kind = match account.kind {
                LoginKind::Oauth if account.is_subscription => "subscription",
                LoginKind::Oauth => "account",
                LoginKind::ApiKey => "API key",
            };
            root = root.child(
                h_flex()
                    .justify_between()
                    .child(Label::new(format!("Signed in to {} ({kind})", account.provider_name)))
                    .child(Button::new(("sign-out", provider_id.clone()), "Sign out").style(ButtonStyle::Outlined).on_click(
                        cx.listener(move |this, _, _, cx| {
                            this.state.update(cx, |state, cx| state.sign_out(provider_id.clone(), cx));
                        }),
                    )),
            );
        }

        if let Some(active) = &state.login {
            let title = format!("Signing in to {}", active.option.provider_name);
            root = root.child(Label::new(title).size(LabelSize::Small));
            root = match &active.step {
                LoginStep::Starting => root.child(Label::new("Contacting the engine…")),
                LoginStep::Browser(url) => root.child(Label::new(format!("Finish signing in in your browser. If it did not open: {url}"))),
                LoginStep::DeviceCode { code, url } => root.child(Label::new(format!("Enter {code} at {url}"))),
                LoginStep::Prompt(prompt) => {
                    let masked = matches!(prompt.prompt.kind, PromptKind::Secret);
                    self.input.update(cx, |input, cx| input.set_masked(masked, cx));
                    root.child(Label::new(prompt.prompt.message.clone())).child(self.input.clone()).child(
                        Button::new("submit", "Continue").on_click(cx.listener(|this, _, _, cx| {
                            let value = this.input.read(cx).text(cx).trim().to_string();
                            if !value.is_empty() {
                                this.state.update(cx, |state, cx| state.submit_prompt(value, cx));
                            }
                        })),
                    )
                }
                LoginStep::Failed(reason) => root.child(Label::new(format!("Sign-in failed: {reason}"))),
            };
            root = root.child(Button::new("cancel", "Cancel").style(ButtonStyle::Outlined).on_click(cx.listener(|this, _, _, cx| {
                this.state.update(cx, |state, cx| state.cancel_login(cx));
            })));
            return root;
        }

        let mut buttons = h_flex().flex_wrap().gap_1();
        for option in &state.login_options {
            let option = option.clone();
            buttons = buttons.child(
                Button::new(("login", format!("{}-{:?}", option.provider_id, option.kind)), option.label.clone())
                    .style(if option.is_subscription { ButtonStyle::Filled } else { ButtonStyle::Outlined })
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.state.update(cx, |state, cx| state.start_login(option.clone(), cx));
                    })),
            );
        }
        root.child(buttons)
    }
}
```

`InputField::set_masked` may not exist at the base (the builder has
`.masked(bool)`); if not, keep two inputs (one masked) and show the one
the prompt kind needs. Record the choice.

In `crates/language_models/src/language_models.rs`, the body of
`register_language_model_providers` becomes:

```rust
    registry.register_provider(Arc::new(knightcode_models::KnightCodeLanguageModelProvider::new(cx)), cx);
```

The parameters `user_store`, `client` and `credentials_provider` are
prefixed with `_`. The `use crate::provider::…` lines that are now unused
(anthropic, bedrock, cloud, copilot_chat, deepseek, google, llama_cpp,
lmstudio, ollama, open_ai, open_router, openai_subscribed, opencode,
vercel_ai_gateway, x_ai) are removed; `open_ai_compatible`,
`anthropic_compatible` (used by `register_compatible_providers`) and the
`pub use` of `MistralLanguageModelProvider` stay. Add
`knightcode_models.workspace = true` to the crate's `Cargo.toml`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p knightcode_models`, then `cargo build -p language_models -p zed`.
Expected: PASS, 5 tests; the build is clean. `cargo test -p
language_models` still passes (its tests cover the compatible providers,
which remain).

- [ ] **Step 5: Validate in the running IDE**

`cargo run -p zed`: Settings > AI shows exactly one provider, KnightCode,
with the sign-in view; no other provider and no API-key form for a Zed
provider is listed. After signing in (or with the CLI already signed in),
Cmd+K in a buffer streams an edit from the engine; the model picker lists
the engine's models grouped under KnightCode with provider-qualified
names. Cmd+K in the terminal and "Generate commit message" in the git
panel work. Record in Validation.

- [x] **Step 6: Commit**

```bash
git add Cargo.toml Cargo.lock crates/knightcode_models crates/language_models/Cargo.toml crates/language_models/src/language_models.rs
git commit -m "feat(knightcode_models): serve every completion surface from the engine"
```

---

## Task 6: Seam 3 — the edit-prediction delegate and the `KnightCode` variant

**Files (fork):**
- Create: `crates/knightcode_models/src/edit_prediction.rs`
- Modify: `crates/settings_content/src/language.rs` (variant, two arms),
  `crates/language/src/language_settings.rs` (one arm),
  `crates/edit_prediction/src/edit_prediction.rs` (two arms),
  `crates/edit_prediction_ui/src/edit_prediction_button.rs` (one arm),
  `crates/agent_ui/src/agent_ui.rs` (one alternative in the palette
  filter; the two `zed_predict_onboarding` lines removed),
  `crates/zed/src/zed/edit_prediction_registry.rs` (variant, three arms),
  `crates/zed/Cargo.toml` (`knightcode_models`)

**Interfaces:**
- Consumes: `edit_prediction_types::{EditPrediction, EditPredictionDelegate, EditPredictionDiscardReason, EditPredictionIconSet, EditPredictionRequestTrigger, interpolate_edits}`,
  `edit_prediction::cursor_excerpt`, `zeta_prompt::compute_editable_and_context_ranges`,
  `language::{Anchor, Buffer, BufferSnapshot, EditPreview}`, `text::ToOffset`,
  `language_model::LanguageModelRegistry`, `knightcode_engine::{Engine, EngineSettings}`.
- Produces:
  - `settings::EditPredictionProvider::KnightCode` (`"knightcode"` in JSON, display name `"KnightCode"`).
  - `pub struct KnightCodeEditPredictionDelegate` with `pub fn new(cx: &mut App) -> Self` and `impl EditPredictionDelegate` (`name()` is `"knightcode"`).
  - `pub fn edit_prediction_model(cx: &App) -> Option<String>` — the
    setting, else the provider's default model's id.

- [x] **Step 1: Write the failing tests**

```rust
// crates/knightcode_models/src/edit_prediction.rs (tests module)
#[cfg(test)]
mod tests {
    use super::*;
    use gpui::TestAppContext;
    use language_model::LanguageModelRegistry;
    use settings::SettingsStore;

    #[gpui::test]
    fn the_model_is_the_setting_then_the_providers_default(cx: &mut TestAppContext) {
        cx.update(|cx| {
            let settings_store = SettingsStore::test(cx);
            cx.set_global(settings_store);
            knightcode_engine::EngineSettings::register(cx);
            language_model::init(cx);
        });
        assert_eq!(cx.read(edit_prediction_model), None, "no setting, no provider");

        cx.update(|cx| {
            let registry = LanguageModelRegistry::global(cx);
            registry.update(cx, |registry, cx| {
                registry.register_provider(Arc::new(language_model::fake_provider::FakeLanguageModelProvider::default()), cx)
            });
        });
        // Only KnightCode's provider counts: a fake provider under another id is ignored.
        assert_eq!(cx.read(edit_prediction_model), None);

        cx.update(|cx| {
            SettingsStore::update_global(cx, |store, cx| {
                store.update_user_settings(cx, |settings| {
                    settings.knightcode.get_or_insert_default().edit_prediction_model = Some("anthropic/claude-haiku-4-5".into());
                });
            });
        });
        assert_eq!(cx.read(edit_prediction_model).as_deref(), Some("anthropic/claude-haiku-4-5"));
    }

    #[test]
    fn the_completion_is_trimmed_of_code_fences() {
        assert_eq!(clean_completion("```rust\nfoo()\n```"), "foo()");
        assert_eq!(clean_completion("  foo()\n"), "  foo()\n");
        assert_eq!(clean_completion("\n"), "");
    }
}
```

The provider-default branch is covered in Task 5's authenticated test
indirectly and by the manual run; a `#[gpui::test]` that registers the
real `KnightCodeLanguageModelProvider` against a fake engine and reads
`edit_prediction_model` is added if the registry's fallback selection
proves reachable without a window — try it, and record either way.

- [x] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p knightcode_models`
Expected: compile errors on the missing module.

- [x] **Step 3: Write minimal implementation**

`crates/settings_content/src/language.rs`: add `KnightCode` to
`EditPredictionProvider` (after `Mercury`); in `is_zed` add
`| EditPredictionProvider::KnightCode` to the `false` group; in
`display_name` add `EditPredictionProvider::KnightCode => Some("KnightCode"),`.

`crates/language/src/language_settings.rs` line 542 area:
`settings::EditPredictionProvider::KnightCode => DelayMs::default(),`.

`crates/edit_prediction/src/edit_prediction.rs`: `is_ep_store_provider`
adds `| EditPredictionProvider::KnightCode` to the `false` group;
`queue_prediction_refresh` adds it to the "non-store" group that logs.

`crates/agent_ui/src/agent_ui.rs` 851–855: add
`| EditPredictionProvider::KnightCode` to the `Zed | Codestral | …` group;
delete the two lines at 862–863 that show `zed_predict_onboarding` and
`OpenZedPredictOnboarding` (a zed.dev sign-up reachable from the command
palette).

`crates/edit_prediction_ui/src/edit_prediction_button.rs`, a new arm next
to Codestral's (198): the icon button with a tooltip "Powered by
KnightCode", an error dot when no model is configured (`knightcode_models::
edit_prediction_model(cx).is_none()`), a popover menu built from
`self.build_language_settings_menu(menu, window, cx)` alone — no provider
switching section and no "configure providers" item, so no other
provider is reachable here. Copy the Codestral arm's structure and delete
what is not needed; about 30 lines. Add `knightcode_models` to
`crates/edit_prediction_ui/Cargo.toml` (this is an additional manifest
line; add it to the §1.10 table).

`crates/zed/src/zed/edit_prediction_registry.rs`:

```rust
        EditPredictionProvider::KnightCode => Some(EditPredictionProviderConfig::KnightCode),
```

in `edit_prediction_provider_config_for_settings`; `KnightCode` in the
`EditPredictionProviderConfig` enum; `EditPredictionProviderConfig::KnightCode => "KnightCode",`
in `name`; and in `assign_edit_prediction_provider`:

```rust
        Some(EditPredictionProviderConfig::KnightCode) => {
            let provider = cx.new(|cx| knightcode_models::edit_prediction::KnightCodeEditPredictionDelegate::new(cx));
            editor.set_edit_prediction_provider(Some(provider), trigger, window, cx);
        }
```

```rust
// crates/knightcode_models/src/edit_prediction.rs
//! Seam 3: Tab. The Codestral delegate's shape over the engine's
//! `/v1/completions`: a prefix and a suffix around the cursor, one request,
//! the returned text inserted at the cursor and re-interpolated as the user
//! types. The model is a setting, else the provider's default model; no
//! list lives here.

use anyhow::{Result, anyhow};
use edit_prediction::cursor_excerpt;
use edit_prediction_types::{
    EditPrediction, EditPredictionDelegate, EditPredictionDiscardReason, EditPredictionIconSet,
    EditPredictionRequestTrigger, interpolate_edits,
};
use gpui::{App, AppContext as _, Context, Entity, Task};
use icons::IconName;
use knightcode_engine::{Engine, EngineSettings};
use language::{Anchor, Buffer, BufferSnapshot, EditPreview};
use language_model::LanguageModelRegistry;
use settings::Settings as _;
use std::{ops::Range, sync::Arc, time::Duration};
use text::ToOffset;

const MAX_EDITABLE_TOKENS: usize = 350;
const MAX_CONTEXT_TOKENS: usize = 150;
const MAX_OUTPUT_TOKENS: u32 = 256;

/// `knightcode.edit_prediction_model`, else the KnightCode provider's
/// default model. `None` until the engine has models.
pub fn edit_prediction_model(cx: &App) -> Option<String> {
    if let Some(model) = &EngineSettings::get_global(cx).edit_prediction_model {
        return Some(model.clone());
    }
    let registry = LanguageModelRegistry::global(cx);
    let provider = registry.read(cx).provider(&crate::provider_id())?;
    Some(provider.default_model(cx)?.id().0.to_string())
}

/// Models sometimes wrap a completion in a fence; the buffer wants code.
fn clean_completion(text: &str) -> String {
    let trimmed = text.trim_matches('\n');
    let unfenced = trimmed
        .strip_prefix("```")
        .map(|rest| rest.split_once('\n').map(|(_, body)| body).unwrap_or(""))
        .map(|body| body.strip_suffix("```").unwrap_or(body).trim_end_matches('\n'))
        .unwrap_or(text);
    if unfenced.trim().is_empty() { String::new() } else { unfenced.to_owned() }
}

#[derive(Clone)]
struct CurrentCompletion {
    snapshot: BufferSnapshot,
    edits: Arc<[(Range<Anchor>, Arc<str>)]>,
    edit_preview: EditPreview,
}

impl CurrentCompletion {
    fn interpolate(&self, new_snapshot: &BufferSnapshot) -> Option<Vec<(Range<Anchor>, Arc<str>)>> {
        interpolate_edits(&self.snapshot, new_snapshot, &self.edits).filter(|edits| !edits.is_empty())
    }
}

pub struct KnightCodeEditPredictionDelegate {
    engine: Entity<Engine>,
    pending_request: Option<Task<Result<()>>>,
    current_completion: Option<CurrentCompletion>,
}

impl KnightCodeEditPredictionDelegate {
    pub fn new(cx: &mut App) -> Self {
        Self { engine: knightcode_engine::global(cx), pending_request: None, current_completion: None }
    }
}

impl EditPredictionDelegate for KnightCodeEditPredictionDelegate {
    fn name() -> &'static str {
        "knightcode"
    }

    fn display_name() -> &'static str {
        "KnightCode"
    }

    fn show_predictions_in_menu() -> bool {
        true
    }

    fn icons(&self, _cx: &App) -> EditPredictionIconSet {
        EditPredictionIconSet::new(IconName::Sparkle)
    }

    fn is_enabled(&self, _buffer: &Entity<Buffer>, _cursor_position: Anchor, cx: &App) -> bool {
        self.engine.read(cx).endpoint().is_some() && edit_prediction_model(cx).is_some()
    }

    fn is_refreshing(&self, _cx: &App) -> bool {
        self.pending_request.is_some()
    }

    fn refresh(
        &mut self,
        buffer: Entity<Buffer>,
        cursor_position: Anchor,
        debounce_duration: Duration,
        _trigger: EditPredictionRequestTrigger,
        cx: &mut Context<Self>,
    ) {
        let Some(client) = self.engine.read(cx).client() else {
            return;
        };
        let Some(model) = edit_prediction_model(cx) else {
            return;
        };
        let snapshot = buffer.read(cx).snapshot();
        if let Some(current) = &self.current_completion
            && current.interpolate(&snapshot).is_some()
        {
            return;
        }

        self.pending_request = Some(cx.spawn(async move |this, cx| {
            if !debounce_duration.is_zero() {
                cx.background_executor().timer(debounce_duration).await;
            }
            let cursor_offset = cursor_position.to_offset(&snapshot);
            let (excerpt_point_range, excerpt_offset_range, cursor_offset_in_excerpt) =
                cursor_excerpt::compute_cursor_excerpt(&snapshot, cursor_offset);
            let syntax_ranges = cursor_excerpt::compute_syntax_ranges(&snapshot, cursor_offset, &excerpt_offset_range);
            let excerpt_text: String = snapshot.text_for_range(excerpt_point_range).collect();
            let (_, context_range) = zeta_prompt::compute_editable_and_context_ranges(
                &excerpt_text,
                cursor_offset_in_excerpt,
                &syntax_ranges,
                MAX_EDITABLE_TOKENS,
                MAX_CONTEXT_TOKENS,
            );
            let context_text = &excerpt_text[context_range.clone()];
            let cursor = cursor_offset_in_excerpt.saturating_sub(context_range.start).min(context_text.len());
            let prefix = context_text[..cursor].to_string();
            let suffix = context_text[cursor..].to_string();

            let text = match client.completion(&model, &prefix, &suffix, MAX_OUTPUT_TOKENS).await {
                Ok(text) => clean_completion(&text),
                Err(error) => {
                    log::warn!("knightcode: edit prediction failed: {error}");
                    this.update(cx, |this, cx| {
                        this.pending_request = None;
                        cx.notify();
                    })?;
                    return Err(anyhow!(error));
                }
            };
            if text.is_empty() {
                this.update(cx, |this, cx| {
                    this.pending_request = None;
                    cx.notify();
                })?;
                return Ok(());
            }

            let edits: Arc<[(Range<Anchor>, Arc<str>)]> = vec![(cursor_position..cursor_position, text.into())].into();
            let edit_preview = buffer.read_with(cx, |buffer, cx| buffer.preview_edits(edits.clone(), cx)).await;
            this.update(cx, |this, cx| {
                this.current_completion = Some(CurrentCompletion { snapshot, edits, edit_preview });
                this.pending_request = None;
                cx.notify();
            })?;
            Ok(())
        }));
    }

    fn accept(&mut self, _cx: &mut Context<Self>) {
        self.pending_request = None;
        self.current_completion = None;
    }

    fn discard(&mut self, _reason: EditPredictionDiscardReason, _cx: &mut Context<Self>) {
        self.pending_request = None;
        self.current_completion = None;
    }

    fn suggest(&mut self, buffer: &Entity<Buffer>, _cursor_position: Anchor, cx: &mut Context<Self>) -> Option<EditPrediction> {
        let current = self.current_completion.as_ref()?;
        let edits = current.interpolate(&buffer.read(cx).snapshot())?;
        Some(EditPrediction::Local { id: None, edits, cursor_position: None, edit_preview: Some(current.edit_preview.clone()) })
    }
}
```

`buffer.read_with(cx, ..)` inside `cx.spawn` follows `codestral.rs`
322–324 at the base; keep whatever form compiles there.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p knightcode_models`, then `cargo build -p zed`.
Expected: PASS; the build is clean, including the six exhaustive matches.

- [ ] **Step 5: Validate in the running IDE**

With `"edit_predictions": { "provider": "knightcode" }` in the user
settings (Task 7 makes it the default), type in a buffer: a ghost-text
completion appears after the debounce; Tab accepts it. The status-bar
button shows the KnightCode icon, its menu offers only the language
toggles. Record in Validation, including the model that served it.

- [x] **Step 6: Commit**

```bash
git add crates/knightcode_models crates/settings_content/src/language.rs crates/language/src/language_settings.rs crates/edit_prediction/src/edit_prediction.rs crates/edit_prediction_ui crates/agent_ui/src/agent_ui.rs crates/zed/Cargo.toml crates/zed/src/zed/edit_prediction_registry.rs Cargo.lock
git commit -m "feat(knightcode_models): serve edit prediction from the engine"
```

---

## Task 7: Startup, defaults, branding

**Files (fork):**
- Modify: `crates/zed/src/main.rs`, `crates/zed/Cargo.toml`
  (`knightcode_engine`), `assets/settings/default.json`,
  `crates/agent/src/agent.rs` (one string),
  `crates/agent_ui/src/agent_panel.rs` (one string),
  `crates/agent_ui/src/agent_ui.rs` (`Agent::label`, one string),
  `crates/release_channel/src/lib.rs` (four strings)

**Interfaces:**
- Consumes: `knightcode_engine::{environment::ensure_loopback_no_proxy, init}`,
  `agent_servers::load_proxy_env`, `command_palette_hooks::CommandPaletteFilter`.
- Produces: an IDE that starts the engine at launch, shows KnightCode as
  the agent's name, defaults Tab to KnightCode, hides the title-bar
  sign-in, and never opens Zed's onboarding.

Branding here is what Phase C's exit condition needs: no zed.dev or
provider surface reachable, and the product named where the user reads
it. Icons, bundle identifiers, the About text and the installer are
Phase D.

- [x] **Step 1: Engine startup in `main.rs`**

Before the HTTP client is built (line 504):

```rust
        // The client reads NO_PROXY once, now; loopback must be in it before
        // that, or a corporate proxy sits between the IDE and its own engine.
        knightcode_engine::environment::ensure_loopback_no_proxy();
```

After `language_model::init(cx)` and before `language_models::init` (line
695):

```rust
        knightcode_engine::init(
            agent_servers::load_proxy_env(cx).into_iter().collect(),
            engine_env_loaded_rx,
            cx,
        );
```

`agent_servers::load_proxy_env` returns a `HashMap<String, String>`;
`crates/zed` already depends on `agent_servers`. On Unix the engine must
start after the login-shell environment is applied (lines 439–450), or it
inherits the bare `PATH` of a desktop launch: split the oneshot into two —
`let (shell_env_loaded_tx, shell_env_loaded_rx) = oneshot::channel();
let (engine_env_loaded_tx, engine_env_loaded_rx) = oneshot::channel();` —
send both in the same spawn, and wrap the second in `Some(..)` on the
non-pty branch and `None` (dropping the sender) on the pty branch, the
way `NodeRuntime::new` receives the first. `init` awaits it before the
first `start` (Task 3).

- [x] **Step 2: Command palette and first open**

After `agent_ui::init` (line 710):

```rust
        // No zed.dev account and no Zed provider is reachable from any surface.
        CommandPaletteFilter::update_global(cx, |filter, _| {
            filter.hide_action_types(&[
                TypeId::of::<client::SignIn>(),
                TypeId::of::<zed_actions::OpenZedPredictOnboarding>(),
            ]);
        });
```

(Check `client::SignIn`'s path at the base — `crates/client/src/client.rs`
line 170 — and add any other zed.dev sign-in action the palette lists:
run the palette, type "sign in", and hide what appears.)

Line 1553: the `FIRST_OPEN` branch opens Zed's onboarding, whose AI page
offers Zed Agent and Copilot. Replace `show_onboarding_view(app_state, cx)`
with the plain `workspace::open_new` the next branch uses, and write the
`FIRST_OPEN` key so the branch is not taken again. Phase E replaces this
with KnightCode's first run.

- [x] **Step 3: Defaults**

`assets/settings/default.json`: `"edit_predictions": { "provider":
"knightcode", …` (line 1860); `"title_bar": { …, "show_sign_in": false`
(line 616); and a new section, placed after `"agent_servers": {}`:

```json
  // KnightCode's engine. Absent values mean: the binary next to the IDE
  // executable, spawned by the IDE, and the default model for edit
  // prediction.
  "knightcode": {
    "engine_path": null,
    "engine_url": null,
    "edit_prediction_model": null
  },
```

- [x] **Step 4: Names**

- `crates/agent/src/agent.rs` 2724: `AgentId::new("KnightCode")`.
- `crates/agent_ui/src/agent_ui.rs` 467: `Self::NativeAgent => "KnightCode".into(),`.
- `crates/agent_ui/src/agent_panel.rs` 5886: `ContextMenuEntry::new("KnightCode")`.
- `crates/release_channel/src/lib.rs` 206–213: `"KnightCode Dev"`,
  `"KnightCode Nightly"`, `"KnightCode Preview"`, `"KnightCode"`.

Then grep the fork for what the user reads with the panel open:
`rg -n '"Zed Agent"' crates` must return only test code and
`crates/onboarding` (unreachable after Step 2) and
`crates/ui/src/components/ai/agent_setup_button.rs` (a component the
onboarding renders). Record the remaining hits.

- [ ] **Step 5: Build, run, and check the exit condition**

`cargo build -p zed`; `cargo run -p zed` against this checkout with the
engine path set. Walk every surface: the agent panel's agent menu lists
KnightCode and any external agents the user configured, nothing else;
Settings > AI lists KnightCode; the status bar's edit-prediction menu
offers no other provider; the title bar has no Sign In; the command
palette has no zed.dev sign-in and no Zed Predict onboarding; the first
launch of a fresh `--user-data-dir` opens a workspace, not the onboarding.
Sign out in the CLI, launch, sign in from the panel: the agent panel,
Cmd+K in a buffer, Cmd+K in the terminal, a commit message and Tab all
work on that one sign-in. Record every observation in Validation.

- [x] **Step 6: Commit**

```bash
git add crates/zed/src/main.rs crates/zed/Cargo.toml assets/settings/default.json crates/agent/src/agent.rs crates/agent_ui/src/agent_panel.rs crates/agent_ui/src/agent_ui.rs crates/release_channel/src/lib.rs Cargo.lock
git commit -m "feat(zed): start the engine at launch and make KnightCode the only AI surface"
```

Then, in this repository, bump the submodule pointer and record the
validation in this document:

```bash
git add apps/desktop/ide apps/desktop/docs/work-packages/03-fork.md
git commit -m "docs(desktop): record the Phase C validation and pin the fork"
```

---

## Implementation notes

Where the code departs from the task text above, and why. Line numbers in
the task text are unchanged; the tests in the tree are authoritative. To
be filled as tasks land; every departure gets one bullet.

- First `git push` of the fork failed with `curl 55 Send failure:
  Connection was reset`. Retried with `http.postBuffer 524288000` and
  `http.version HTTP/1.1`.
- Repository created private with `gh repo create` (plan default).
- First `cargo build -p zed` failed because `cmake` was not on `PATH`.
  It is installed with VS 18 Build Tools at `Common7/IDE/CommonExtensions/
  Microsoft/CMake/CMake/bin` (`cmake 4.1.1-msvc1`). Followed
  `docs/src/development/windows.md` (add that bin directory to `PATH`);
  did not patch the build. Retrying.
- Second `cargo build -p zed` failed in `msvc_spectre_libs`'s build script:
  no `lib/spectre/x64` under the MSVC 14.50 toolchain. The VS 2022 Build
  Tools install on this machine carries no MSVC toolchain at all, so the
  build uses VS 18's. Installed
  `Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre` into the
  VS 18 Build Tools with `setup.exe modify` (elevated), as `windows.md`
  lists; did not patch the build.
- Third `cargo build -p zed` failed compiling `webrtc-sys`'s C++: `error
  C2061: syntax error: identifier 'FILE_INFO_BY_HANDLE_CLASS'` in Windows
  SDK 10.0.22621's `fileapi.h`, the only SDK on the machine, which MSVC
  14.50 no longer accepts. Installed
  `Microsoft.VisualStudio.Component.Windows11SDK.26100` (the SDK
  `windows.md`'s component list names) the same way; `cc` picks the
  newest SDK. Did not patch the build.
- Task 2: the `knightcode` section costs one more upstream line than
  §1.10 budgets: `SettingsContent` is also built as an exhaustive literal
  in `crates/settings/src/vscode_import.rs` (`knightcode: None,`), and its
  field list is enumerated once more in the `flattened_deserialize!`
  invocation in `settings_content.rs` (one word). Added to the fork-surface
  table.
- Task 2: `parse_port_line` accepts the JSON object wherever it starts on
  the line. The fake engine's port line arrives as
  `test process::tests::fake_engine ... {"type":"listening",...}` because
  libtest prints the test name without a newline before running it; the
  real engine's line is clean, and the tolerance is the "stray output"
  robustness the test was written for. One more assertion covers the
  prefixed form.
- Task 2: `EngineProcess` has a manual `Debug` (port only) because the
  plan's tests call `unwrap_err` on `Result<EngineProcess, _>` and
  `BoxFuture` is not `Debug`. `StartError`'s messages reference fields as
  `.stderr` / `.path.display()` (thiserror's syntax for extra format
  arguments). `smol::Timer::after` is clippy-denied workspace-wide; the
  gpui-free modules (`process.rs`, later `login.rs`) use it through one
  `#[allow(clippy::disallowed_methods)]` site each, the pattern
  `crates/git/src/repository.rs` already uses.
- Task 3: `Entity::update` and `Entity::read_with` are infallible under
  `AsyncApp` at the base (only `WeakEntity`'s return `Result`), so the
  `?`/`.ok()` the task text puts on them are dropped. `LoginOutcome`
  derives `Debug` for the tests' `unwrap_err`. `Engine::watch_events`
  retries through `BackgroundExecutor::timer` (captured before the spawn)
  rather than `smol::Timer`, so only the two gpui-free modules carry the
  clippy allowance. Neither gpui test needed a fake HTTP client set by
  hand: `TestAppContext` installs a 404 fake by default.
- Task 4: `knightcode_agent` gains one dev-dependency the task text lacks,
  `workspace = { workspace = true, features = ["test-support"] }`.
  `project/test-support` turns on `remote/test-support`, which adds
  `RemoteConnectionIdentity::Mock`; `workspace` only matches that variant
  under its own `test-support`, so without it the test build fails in
  `crates/workspace/src/persistence.rs` (upstream feature unification;
  `crates/editor/Cargo.toml` carries the same line for the same reason).
  The first test matches on `connect`'s result instead of `unwrap_err`
  because `dyn AgentConnection` is not `Debug`.
- Task 4 Step 5 (running-IDE validation) is deferred to Task 7 Step 5:
  `knightcode_engine::global` is only installed by `init`, which Task 7
  wires into `main.rs`; before that the panel's `connect` has no engine
  to ask. The same holds for Task 5 Step 5 and Task 6 Step 5.
- Task 5: `InputField::set_masked` exists at the base but needs a
  `Window`, and `Editor::set_masked` notifies unconditionally, so calling
  it on every render would re-render forever. `SignInView` keeps a
  `masked: bool` and only updates the editor when the prompt kind changes
  (one input, not two). `settings_view` takes `&mut App`, so the first
  provider test reads it under `cx.update` rather than `cx.read`.
  `language_models`'s own suite still passes (90 tests).
- Task 6: the provider-default branch of `edit_prediction_model` proved
  reachable without a window, so the optional test was added
  (`without_a_setting_the_model_is_the_providers_default`: a fake engine,
  the real provider registered, `authenticate`, then the first model's
  `ref`). `SettingsStore::update_global` needs `gpui::UpdateGlobal` in
  scope. The status-bar arm is 55 lines, not 30: the indicator and
  tooltip plumbing Codestral's arm carries is what makes the button read
  the same. `crates/zed/Cargo.toml` gains `knightcode_models` here (Task
  7 adds `knightcode_engine`).
- Task 7: `EditPredictionProvider` is `rename_all = "snake_case"`, so the
  `KnightCode` variant serialised as `knight_code` and `default.json`'s
  `"provider": "knightcode"` made the IDE panic at startup while parsing
  its defaults. The variant carries `#[serde(rename = "knightcode")]`;
  `cargo test -p settings` (37 tests, which parse `default.json`) now
  covers it. Found by running the IDE, not by the task's tests.
- Task 7: `agent_servers` was an optional, test-support-only dependency of
  `crates/zed` at the base, not a plain one as the task text says; it is
  made plain (and dropped from the `test-support` feature list) for
  `load_proxy_env`, and `command_palette_hooks` is added for the filter.
  `crates/zed/Cargo.toml` is therefore three added lines and two changed,
  against the budgeted two.
- Task 7: the palette listed `client: sign out` after `client: sign in`
  was hidden; `client::SignOut` is hidden too. `copilot edit predictions:
  reinstall` remains listed (Copilot's own LSP reinstall, not a provider
  dialog; it is what stock Zed shows for every non-Copilot provider).
- Task 7: the first-open branch writes `FIRST_OPEN` itself with
  `db::write_and_log`, the way the onboarding did, so the branch is not
  taken twice; `show_onboarding_view` is no longer imported.
- Task 7: the fork's `main` is committed but not pushed; the push was
  refused by the session's permission policy. The submodule pointer below
  names a commit that exists only locally until `git -C apps/desktop/ide
  push origin main` is run.
- Upstream line count: `git diff --stat knightcode-base` outside
  `crates/knightcode_*` is 348 lines across 19 files, of which 136 are the
  deleted provider registrations in `language_models.rs` and 55 the
  status-bar arm; the rest total under 120.

---

## Required tests

Every invariant below must be covered before WP03 is called done. The
tasks add them; this list is the reviewer's checklist, not a second
suite.

Engine, in `packages/cli/test/engine/`, faux provider, no session created:

- the engine prints one port line, answers `/health`, and exits `0` when
  its stdin closes; a pinned port is bound, a taken pinned port is an exit
  before ready with `EADDRINUSE` on stderr and nothing on stdout, and a
  malformed `KNIGHTCODE_ENGINE_PORT` is exit `2` (Task 0);
- the streamed error frame is an `error` object with `type` and
  `message` (Task 0).

Fork, `cargo test -p knightcode_engine -p knightcode_agent -p knightcode_models`:

- `NO_PROXY` gains the three loopback hosts once, case-insensitively; the
  engine environment carries the token, the pinned port when restarting,
  the settings proxy, and drops `DEBUG` (and `LD_PRELOAD` on Linux); a
  token is 48 hex characters; the binary is found by setting, then
  environment, then sibling, and absence names the path tried (Task 2);
- `start` reports a missing binary by path, an exit before ready with its
  status and stderr, a stall within the timeout with the child killed, and
  a rejected token as its own error; a ready engine is one whose port line
  arrived, whose `/health` answered, and whose `/v1/accounts` accepted the
  token, and closing its stdin ends it before the kill deadline (Task 2);
- the client parses accounts, models, login states and events, sends the
  bearer on every call, posts the documented bodies, maps an engine error
  status to `ClientError::Status` with the engine's code, reads
  `prompt`/`suffix` completions, and skips SSE comments (Task 3);
- a login reports each event once, returns on completion, parks on a
  prompt and resumes after submit, and fails with the engine's reason
  (Task 3);
- three exits within a minute stop restarts; older exits do not count;
  delays are 1, 2, 4 s; `ready` fails with the `Failed` message verbatim
  and resolves when the engine becomes ready (Task 3);
- `connect` surfaces the engine's failure verbatim; the connection wrapper
  offers OAuth login options and no API-key option, passes
  `downcast::<AcpConnection>()`, and `authenticate` opens the URL the
  engine reports and completes; the crate links no credential provider
  (Task 4);
- the provider is unauthenticated with no credential and its
  `authenticate` returns `CredentialsNotFound` without opening a browser;
  authenticated models carry provider-qualified ids and distinct names;
  a login opens the browser and, on completion, the provider is
  authenticated; requests flatten to text with mapped roles, no tools,
  `stream: true`; the crate links no credential provider (Task 5);
- the edit-prediction model is the setting, else the KnightCode
  provider's default; fenced completions are unwrapped (Task 6);
- in the running IDE: one sign-in serves the panel, Cmd+K in a buffer,
  Cmd+K in the terminal, a commit message and Tab; no provider dialog,
  Zed API-key form, or zed.dev sign-in is reachable (Task 7).

---

## Exclusions

Do not add in this work package:

- any Rust that reads `auth.json`, caches a credential, or calls
  `credentials_provider` / `zed_credentials_provider`;
- a Rust port of any part of `packages/ai` or `packages/agent`, including
  a chat-completions client of our own: `open_ai::stream_completion` and
  `ChatCompletionEventMapper` are the client;
- a model list, a default model name, or a provider name in Rust;
- changes to `agent_panel.rs`, `conversation_view.rs` or `mention_set.rs`
  (§1.4), or to `AcpConnection`;
- `session/list`, `session/load`, thread history for KnightCode threads,
  `@thread` mentions;
- a first-run screen, a device-code sheet, or a sign-in modal in the
  panel; the panel offers OAuth buttons and points at Settings > AI
  (Phase E);
- an "always allow" that survives the session, or any permission policy;
- icons, bundle identifiers, installer metadata, the About dialog
  (Phase D);
- deletion of Zed's provider modules, `collab`, `cloud_llm_client`,
  `zeta_prompt`, or `register_compatible_providers` (settings-only,
  never a dialog);
- telemetry from the IDE that the CLI does not already send;
- a `--token` argument anywhere;
- engine changes beyond Task 0's three;
- anything under `packages/cli/src/core`, `packages/ai`, `packages/agent`.

---

## Validation

In this repository, from the root:

```bash
bun run check-types
```

```bash
cd packages/cli && bun x vitest --run test/engine
```

Confirm Task 0 stayed inside the engine:

```bash
git diff --stat main -- packages/cli/src/core packages/ai packages/agent
```

Expected: no output.

In the fork, from its root:

```bash
cargo build -p zed
```

```bash
cargo test -p knightcode_engine -p knightcode_agent -p knightcode_models
```

Confirm no credential reaches the Rust side (architecture §13):

```bash
rg -n "api_key|API_KEY|Bearer |auth\.json|credential" crates/knightcode_agent crates/knightcode_models crates/knightcode_engine
```

Expected: `knightcode_engine/src/process.rs` and `client.rs` — the
`Authorization: Bearer` header built from the launch token; the two
`no_code_path_can_reach_zeds_credential_provider` tests; the `api_key`
serde rename in `client.rs` (`LoginKind::ApiKey`) and its uses in
`connection.rs` and `sign_in.rs`. Nothing else.

Confirm one provider registration:

```bash
rg -n "register_provider" crates/language_models/src/language_models.rs
```

Expected: the `KnightCodeLanguageModelProvider` call, the two calls in
`register_compatible_providers`, and the test module.

Confirm the token never reaches argv:

```bash
rg -n "\-\-token|--token" crates/knightcode_agent crates/knightcode_engine
```

Expected: no matches.

Confirm the fork surface:

```bash
git diff --stat knightcode-base -- crates assets Cargo.toml | grep -v "crates/knightcode_"
```

Expected: exactly the files in the §1.10 table (plus `Cargo.lock`), each
with the line count the table budgets or fewer.

### Results, 2026-09-12

Commands above, run at fork head `a5736b7a06` (Task 7 at `225ee2b716`):

- `bun run check-types`: `tsc --noEmit`, clean.
- `bun x vitest --run test/engine`: `Test Files 19 passed (19)`,
  `Tests 137 passed (137)`.
- `git diff --stat main -- packages/cli/src/core packages/ai
  packages/agent`: no output.
- `cargo build -p zed`: `Finished dev profile`, exit 0, after every task;
  the one warning is upstream's LNK4217 linker message from
  `wasmtime_c_api`/`tree_sitter`.
- `cargo test -p knightcode_engine -p knightcode_agent -p
  knightcode_models`: 23, 4 and 8 passed; 0 failed.
- Credential grep: the two `Authorization: Bearer` headers built from the
  launch token (`process.rs`, `client.rs`), the fake engine's bearer check
  in `process.rs`'s tests, the two `no_code_path_can_reach_zeds_
  credential_provider` tests, `LanguageModelProvider::
  missing_credentials_error_message`, doc comments, and the `"type":
  "api_key"` wire value in one test fixture. No `api_key` serde rename
  exists: `LoginKind::ApiKey` is `snake_case` by the enum attribute.
- `register_provider` in `language_models.rs`: line 208 (KnightCode) and
  the two `register_compatible_providers` calls; the test module has
  none.
- `--token`: no matches.
- Fork surface: exactly the §1.10 table plus `crates/settings/src/
  vscode_import.rs` (one line, recorded) and `Cargo.lock`.
- `git merge upstream/main` (`a936ce01c1`, 2026-09-12) on a scratch
  branch: applied with no conflicts at all; discarded.

Running-IDE record. Zed base `a57ba9b17c433ea1ebfdec8f649f4fa5a402d03b`;
Windows 11 Home 10.0.26200; 2026-09-12 00:54–01:06 IST; engine binary
`packages/cli-win32-x64/bin/knightcode-engine.exe` built 2026-09-11 18:21
(prints its port line and exits 0 on stdin EOF; `acp --connect` exits 0
on stdin EOF); launched as `target/debug/zed.exe --user-data-dir <fresh>
<this checkout>` with `KNIGHTCODE_ENGINE_PATH` set. The CLI on this
machine was already signed in, and `auth.json` is shared, so the empty
state was not exercised.

- Engine: `zed.exe` spawned `knightcode-engine.exe` directly (the child's
  command line is the bare binary path; no shell, no token on argv).
- Agent panel: opened as "New KnightCode Thread"; the composer's
  placeholder reads "Message the KnightCode, @ to include context, / for
  commands" (Zed's template around the agent id); the model picker showed
  the engine's models (Grok 4.6, xhigh); no sign-in prompt, the shared
  sign-in was used. The adapter ran as `knightcode-engine acp --connect
  http://127.0.0.1:61587` under Zed's PowerShell wrapper, as every ACP
  agent does.
- Agent menu (new thread): KnightCode, Terminal, Add More Agents. No Zed
  Agent.
- Settings > AI > LLM Providers: one provider, KnightCode, showing the
  sign-in view — five signed-in accounts each with Sign out, and the
  engine's login options as buttons. No API-key form for a Zed provider.
  "Add Provider" (Zed's settings-only compatible providers) remains, as
  Exclusions allow.
- Title bar: no Sign In button.
- Command palette: "sign in" listed no zed.dev sign-in; `client: sign out`
  was still listed at that build and is hidden in the committed build
  (rebuilt, not re-run). "predict" listed no Zed Predict onboarding.
- First launch with a fresh `--user-data-dir`: Zed's project-trust dialog,
  then a workspace on the project; not the onboarding.
- Quit: `WM_CLOSE` to the IDE window; `zed.exe` exited 0 and both
  `knightcode-engine.exe` processes (engine and adapter) were gone within
  8 s.
- Not exercised in this run, each of which sends a request to a paid
  model on the owner's live accounts, or needs the owner's keyboard: a
  prompt in the panel and the three WP02 scenarios, Cmd+K in a buffer,
  Cmd+K in the terminal, "Generate commit message", Tab (with the CLI
  signed in, opening any buffer arms edit prediction on the default
  model), the status-bar edit-prediction menu, and sign-out-then-sign-in
  from the panel. These are the owner's walk; see the checklist in the
  handover.

---

## Stop condition

WP03 is complete when:

- `KnightCodeAI/knightcode-ide` exists with `upstream` pointing at Zed,
  `knightcode-base` tagged at the recorded commit, and this repository's
  `apps/desktop/ide` submodule pointing at the fork's head;
- the IDE starts its engine at launch with a generated token, proves the
  token before any adapter is spawned, surfaces a missing binary, an
  exit before ready, a stall and a rejected token as readable messages,
  restarts after a crash with backoff and stops after three in a minute,
  and closes the engine's stdin at quit;
- one sign-in inside the IDE — the panel's OAuth button or Settings > AI —
  serves the agent panel, Cmd+K in a buffer, Cmd+K in the terminal, a
  commit message and Tab, and the three WP02 scenarios pass against the
  fork;
- no provider dialog, Zed API-key form, zed.dev sign-in or Zed onboarding
  is reachable from the agent panel, Settings > AI, the status bar, the
  title bar, the command palette or first launch;
- every invariant in *Required tests* has a passing test, and every grep
  in *Validation* returns only its expected matches;
- the upstream files changed are exactly the §1.10 table, and
  `git merge upstream/main` into a scratch branch conflicts only inside
  them (run once before calling the package done, then discard);
- nothing under `packages/cli/src/core`, `packages/ai` or
  `packages/agent` changed.

---

## Questions for the owner (answers change Task 1 only)

1. Repository visibility for `KnightCodeAI/knightcode-ide`: public (Zed's
   licence needs source available to whoever receives a binary, and a
   public fork is the simplest way to meet that) or private until Phase D?
   The plan assumes private and flips it when asked.
2. Who creates the repository: `gh repo create` under the owner's account
   in Task 1 Step 1, or the owner beforehand (then Step 1 only pushes)?
3. Task 0 changes three engine files in this repository. Land them as a
   commit on the WP03 branch, or as their own small PR before the fork
   work starts? The plan assumes the same branch.
