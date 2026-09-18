# WP06 — first run, branding and launch (Phase E)

Status: implemented 2026-09-18. Tasks 1 through 8 done and green; Task 0's
upstream merge and Task 9's release, dashboard and hardware walks are owed.
See **Implementation report** at the end for what deviated and what is left.
Date: 2026-09-17
Revision: 3 — telemetry routed to KnightCode's PostHog (Task 1b) rather
than switched off; a shared telemetry setting added to Task 4; the launch
signal allowlist approved and added as Task 1c, with architecture §12.1

Implement this plan task by task, in order. Each task carries its own check
cycle; do not start the next until the current one's checks pass and the
build is clean. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the IDE is ready to be handed to a stranger. A clean machine
installs it, is walked through signing in and picking a model without ever
touching a terminal, and lands in a project. Nothing the user reads, clicks
or is sent to says Zed, except where we credit it on purpose. Nothing the
install sends reaches Zed Industries' servers unless the user opened the
extensions page, and the one thing it does send — an anonymous install ping
— lands in KnightCode's own PostHog beside the CLI's, so launch day has a
number instead of a guess.

**Architecture:** three separable pieces, in dependency order.

1. *Two holes that must close before any public build.* A shipped IDE
   currently POSTs usage events to `api.zed.dev`, and Settings > AI has an
   "Add Provider" button that opens an API-key field writing to Zed's
   credential store. Both contradict §12 and §15 of the architecture, and
   both were found by reading the code, not by a failing test. They are
   Tasks 1 and 2 because everything after them is cosmetic by comparison.
   Closing the first one replaces Zed's pipeline rather than merely deleting
   it: KnightCode's PostHog project already counts CLI installs, and Task 1b
   puts the IDE in the same funnel through the same anonymous route, with no
   write key in the binary and no identity in the payload.
2. *First run,* which is Phase E as the architecture describes it: a new
   `crates/knightcode_onboarding` replaces the stopgap at
   `crates/zed/src/main.rs:1584` and Zed's own onboarding and welcome
   pages. It reuses the sign-in state machine that WP03 already built and
   parked for this phase, and adds the one thing that machine cannot do
   yet: record which model the user chose. That needs an engine route, so
   Task 4 spans both halves.
3. *The branding sweep and the credit,* which is bulk work with a scripted
   gate: an inventory of every user-visible Zed string, a decision per
   surface, and a check that keeps new ones out.

**Tech stack:** Rust with Zed's `gpui` test harness in the fork;
TypeScript with Vitest and the faux provider for the engine route;
PowerShell, bash and Inno Setup for the bundle renames; Python 3.11 with
Pillow for the brand SVG, extending
`apps/desktop/scripts/generate-icons.py`. Analytics is PostHog project
596276, reached only through the existing Next.js route on knightcode.dev,
never from a client.

**Spec:** `apps/desktop/docs/architecture.md` — §6 Credentials and sign-in
(first run is spelled out in §6.2 and §6.3), §10 Phase E, §12 Exclusions,
§13 Validation, §14 Known limitations, §15 Stop condition.
`apps/desktop/docs/repositories.md` §4 and §5. WP03's Exclusions list what
it deferred here; WP04's Exclusions name the first-run screen explicitly.

**Owner's answers (2026-09-17):**

- **Extensions stay on Zed's registry.** The page keeps working against
  `api.zed.dev/extensions`. Its copy is cleaned and one honest line credits
  the Zed extension registry. No proxy on knightcode.dev.
- **`.zed/` stays.** Project-local settings keep that folder name, so a
  project configured for Zed opens correctly here. It is the one Zed string
  that survives on purpose, and the only one in a path.
- **Documentation links keep pointing at `zed.dev/docs`,** relabelled so it
  is clear they describe the editor we build on rather than KnightCode.
  Install and first-run documentation of our own is still written, on
  knightcode.dev, in Task 8.
- **Telemetry goes to KnightCode's PostHog, not nowhere.** The IDE joins
  the install funnel the CLI already feeds, through the existing
  `knightcode.dev/api/report-install` route and PostHog project 596276.
  Zed's own pipeline stays dead; see Task 1b for why repointing it was
  rejected.

---

## Global Constraints

Copied from WP04 and `AGENTS.md`. Every task's requirements implicitly
include this section.

- Never add a `Co-Authored-By` trailer, a session line, or a "Generated
  with" footer to a commit message or a PR body. Strip them if something
  adds them.
- Never commit unless asked. When asked: one commit per task, message
  format `{feat,fix,docs,chore}(<scope>): <message>`, root-cause reasoning
  in the body, staged by explicit path. Never `git add -A` or `git add .`.
  Never `git reset --hard`, `git checkout .`, `git stash`, `--no-verify`,
  or a force push.
- Committed text carries no trace of tooling or reference trees: no skill
  names, no assistant names. Cite Zed and OpenCode by their own paths.
- Do not run `bun run build:cli`, `bun run build:engine` or a full test
  suite unless asked. Task 4 needs `build:engine` once to test the new
  route from a compiled binary; ask first, and say why.
- Never spend paid provider tokens in a test. The root `.env` is
  auto-loaded by Bun and carries real keys. Every engine test uses the faux
  provider, a throwaway `KNIGHTCODE_CODING_AGENT_DIR` and
  `KNIGHTCODE_OFFLINE=1`, and creates no session. The only place real
  tokens are spent here is Task 9's walk, which is the exit condition and
  is run by hand.
- Windows is the primary platform. Absolute paths across every process
  boundary, forward slashes in JSON. Write source files with a file-write
  tool, not bash heredocs — they eat backslashes.
- `CARGO_BUILD_JOBS=4`. The default job count crashed `rustc` on this
  machine, and took a running editor with it.
- The fork is additive. Every line changed in an upstream file is merged
  again on every Zed release. Before editing anything outside
  `crates/knightcode_*`, confirm it belongs in the fork-surface table in
  the fork's `README.md`, and add your row when it does. Nothing in
  `editor`, `project`, `workspace`, `terminal`, `git`, `vim` or `gpui`.
- No Rust reads `auth.json`, caches a credential, or links
  `credentials_provider`. The launch token is the only secret, and it
  travels in the environment only — never on argv.
- No hard-coded model choice anywhere, in either half. The user picks; the
  engine records it. A per-provider default table in Rust is a defect.

---

## Mandatory reading

Read these before Task 0, in this order. Line numbers are from
`ecc7a320fe` in the fork and `922eeb460` here.

1. `apps/desktop/docs/architecture.md` §6, §10, §12, §13, §14, §15.
2. `apps/desktop/docs/repositories.md`, whole, twice.
3. The fork's `README.md` — the fork-surface table is the contract this
   work package extends.
4. `apps/desktop/docs/work-packages/03-fork.md`, its Implementation notes
   and Validation; `04-packaging.md` Exclusions; `05-updates.md` §5.
5. `crates/knightcode_models/src/state.rs` — the login and catalog state
   machine, and the comment at `:81` explaining why the IDE does not choose
   a model.
6. `crates/knightcode_models/src/sign_in.rs` — 135 lines, the view this
   phase promotes to a first-run screen.
7. `crates/zed/src/main.rs:1584` — the stopgap this phase replaces, and its
   comment saying so.
8. `apps/web/app/api/report-install/route.ts`, whole, 60 lines — the
   anonymous reporting path Task 1b extends, and the reason no write key
   goes near a client.
9. `packages/cli/src/core/telemetry.ts` and
   `packages/cli/src/modes/interactive/interactive-mode.ts:1210`–`:1255` —
   the opt-out and the once-per-version rule the engine's ping reuses
   rather than reinvents.

---

## Design

Everything in this section was verified by reading the tree at the commits
above. Where a claim is a measurement, the command that produced it is
given.

### 1. The IDE talks to `api.zed.dev` today

`crates/zed/src/main.rs:603` starts `Telemetry`. `report_event`
(`crates/client/src/telemetry.rs:566`) returns early only when
`settings.metrics` is false, and `assets/settings/default.json:1654` sets
`telemetry.metrics` to `true`. Queued events flush through
`flush_events_inner` (`:660`) and `build_request` (`:637`), whose URI is
`http_client.build_zed_api_url("/telemetry/events")`.
`crates/http_client/src/http_client.rs:276` rewrites the `https://zed.dev`
base — `assets/settings/default.json:2795` — to `https://api.zed.dev`.

The body carries `system_id`, `installation_id`, `session_id`,
`app_version`, OS, OS version, architecture and the release channel, which
reads `KnightCode`.

`ZED_CLIENT_CHECKSUM_SEED` is not set in our builds, so the
`x-zed-checksum` header is empty and the server will reject the payload.
That is not a defence: the request is still made, and it still announces a
KnightCode install to a third party. `has_checksum_seed`
(`crates/client/src/telemetry.rs:352`) exists but is called from nowhere —
`rg -n "has_checksum_seed" crates/` returns one line, its own definition.

Crash reports are already safe, and by the pattern this task should copy:
`MINIDUMP_ENDPOINT` (`crates/client/src/telemetry.rs:92`) is
`option_env!("ZED_MINIDUMP_ENDPOINT")`, unset in our bundles, and
`upload_previous_minidumps` returns early without it. Telemetry needs the
same gate.

### 1b. We already have a telemetry sink, and the IDE is not in it

KnightCode's analytics is PostHog project 596276 ("Default project",
organisation KnightCode). It is live and it has exactly one event flowing:

```text
call read-data-schema {"query": {"kind": "events"}}
→ cli_install     (seen in the last 30 days)
→ everything else (not seen in the last 30 days)
```

`cli_install` carries `product`, `version`, `ua_version`, `os`, `runtime`,
`arch`, `country`, `region`, `city` and `$lib`. Nothing else in either
repository sends to PostHog: `rg -n "posthog|POSTHOG"` over `apps/web`,
`packages/` and the root manifests returns four lines, all inside
`apps/web/app/api/report-install/route.ts`.

The path that produces it is worth copying exactly, because it already
solves the two problems the IDE has:

1. **No key in the client.** `reportInstallTelemetry`
   (`packages/cli/src/modes/interactive/interactive-mode.ts:1239`) does a
   bare `GET https://knightcode.dev/api/report-install?version=…` with a
   user agent and no body. The `POSTHOG_KEY` write token lives in Vercel's
   environment, read by the route. A key compiled into the IDE would be a
   key published in a public GPL repository.
2. **No identity.** The route derives `distinct_id` from
   `SHA-256(ip + "|" + user-agent)`, truncated to 16 bytes, and stores
   neither input. Repeat pings from one machine collapse to one person
   without an installation id ever existing. Zed's pipeline, by contrast,
   sends `system_id`, `installation_id` and `metrics_id`.

The ping fires once per version, not once per run: `getChangelogForDisplay`
(`:1210`) compares `VERSION` against `lastChangelogVersion` and calls the
report only when the stored value is absent or older. It is suppressed by
`KNIGHTCODE_OFFLINE`, and gated by `isInstallTelemetryEnabled`
(`packages/cli/src/core/telemetry.ts:8`): the `KNIGHTCODE_TELEMETRY`
environment variable if set, otherwise `enableInstallTelemetry` from
settings, which defaults to `true`
(`packages/cli/src/core/settings-manager.ts:1071`).

`enableAnalytics` and `trackingId` also exist in settings
(`:129`, `:130`) and nothing reads them to send anything. They are dead, and
this work package leaves them dead.

**One defect in the existing route.** `cli_install` carries the full
`$geoip_*` property set, which PostHog derives from the IP that reached
`/i/v0/e/`. That IP is Vercel's egress, not the user's, so every
`$geoip_country_name` on that event is wrong. The route already sends the
user's real `country`, `region` and `city` from the Vercel edge headers, so
the `$geoip_*` set is not merely wrong but redundant. One property fixes it.

### 2. Settings > AI can still open a Zed API-key field

`crates/language_models/src/language_models.rs` has three
`register_provider` calls, not the one §13 expects.
`register_language_model_providers` (`:201`) registers only
`KnightCodeLanguageModelProvider`, which is what WP03 changed. But
`register_compatible_providers` (`:161`) is upstream code the fork left
untouched, and it registers `OpenAiCompatibleLanguageModelProvider` or
`AnthropicCompatibleLanguageModelProvider` for every entry under
`language_models.openai_compatible` in settings.

That is reachable without editing JSON:
`crates/settings_ui/src/pages/llm_providers_page.rs:73`
(`render_add_llm_provider_popover`) draws an **Add Provider** button on the
AI settings page with an "OpenAI" and an "Anthropic" entry. The resulting
provider's key is written through
`credentials_provider::CredentialsProvider`
(`crates/language_models/src/provider/open_ai_compatible.rs:2`), which is
the OS keychain — not the shared `auth.json`.

So today the IDE contradicts two lines of §15 at once: "no surface in the
IDE can reach a provider dialog, an API key field belonging to Zed", and
"credentials exist only in the shared `auth.json`". §13's grep was written
expecting one match and there are three; the grep needs correcting too, or
it will keep passing over this.

### 3. A clean install has no model for four of the five surfaces

`GET /v1/models` (`packages/cli/src/engine/models.ts:30`) returns
`default: null` unless the CLI's settings name a provider *and* a model
(`:59`–`:62`). Nothing writes those settings except the CLI's interactive
session (`packages/cli/src/core/agent-session.ts:1752`, `:1819`, `:1854`)
and the experimental models provider. There is no route to set them; the
engine's route list is `/v1/accounts`, `/v1/accounts/login`,
`/v1/chat/completions`, `/v1/completions`, `/events`, `/v1/models` and
`/v1/sessions`.

On the IDE side `State::default_model`
(`crates/knightcode_models/src/state.rs:81`) returns `None`, so
`KnightCodeLanguageModelProvider::default_model` returns `None`
(`crates/knightcode_models/src/knightcode_models.rs:81`). That is what
buffer inline assist, terminal inline assist, commit-message generation and
thread titles fall back to.

Two surfaces escape, which is why this was not caught earlier:

- The agent panel asks over ACP, and a new session resolves its own model
  through `findInitialModel` step 4
  (`packages/cli/src/core/model-resolver.ts:702`), which takes the first
  available model. It then exposes a per-session picker through
  `toConfigOptions` (`packages/cli/src/engine/acp/agent.ts:99`).
- Tab reads `knightcode.edit_prediction_model` from the IDE's own settings
  (`crates/knightcode_engine/src/settings.rs`) and has its own picker,
  added after WP03.

So on a clean machine the exit condition of §15 — "the agent panel, Cmd+K
in a buffer, Cmd+K in the terminal, commit message generation, and Tab
prediction are all served by that one login" — fails on three of the five
for want of a recorded choice, not for want of a credential. Task 4 fixes
it in the one place both front doors read.

### 4. First run has a spec and half an implementation

§6.2 fixes the order of the offers: Continue with Claude, Continue with
ChatGPT, Continue with Copilot, Use an API key. §6.3 fixes the skip: a
machine where the CLI is already signed in is already signed in here,
because it is the same file, so first run detects credentials through
`GET /v1/accounts` and skips the sign-in step.

`SignInView` (`crates/knightcode_models/src/sign_in.rs`) already drives
every login kind the engine offers — browser, device code, and a prompt for
a value — and its header comment says this phase promotes it. The state
machine stays; only its presentation changes.

`crates/zed/src/main.rs:1584` is the stopgap: on the `FIRST_OPEN` key being
absent it opens a plain workspace with an empty buffer and writes the key,
with a comment saying KnightCode's own first run replaces it.

Zed's own onboarding is still reachable and still says Zed:

- `zed::OpenOnboarding` opens `crates/onboarding/src/onboarding.rs`, whose
  header renders `VectorName::ZedLogo` and the headline "Welcome to Zed"
  (`:350`, `:354`).
- Help > Show Welcome (`crates/zed/src/zed/app_menus.rs:309`) opens
  `crates/workspace/src/welcome.rs`, headline "Welcome to Zed" at `:453`
  with the logo at `:480`.
- `crates/onboarding/src/basics_page.rs` offers a "Zed Agent" sign-in
  (`:653`), a Zed Pro trial link (`:660`), and two telemetry switches whose
  labels are "Help improve Zed…" (`:253`) and "Help fix Zed…" (`:293`).

Neither is in the command-palette hide list at `crates/zed/src/main.rs:737`.
That list currently hides `client::SignIn`, `client::SignOut`,
`OpenZedPredictOnboarding`, `ViewReleaseNotesLocally`, `FileBugReport`,
`RequestFeature`, `EmailZed` and `OpenZedRepo`. It does not hide
`zed::GetMerch` (`crates/zed/src/zed.rs:922`, opens Zed's merchandise
store), `zed::OpenAccountSettings` (`:269`, opens a zed.dev account page),
`zed::OpenOnboarding` or `onboarding::ShowWelcome`.

The welcome page lives in `workspace`, which the fork does not touch.
Hiding the action and dropping the menu entry achieves the same result
without a line in a forbidden crate.

### 5. The branding inventory, measured

```bash
grep -rn --include=*.rs -E '"[^"]*([Zz]ed\b|zed\.dev)[^"]*"' crates/ \
 | grep -vE '/(tests|fixtures|benchmarks)/|_tests?\.rs:|/stories/|component_preview|/eval|test_support' \
 | grep -vE '^crates/(collab|collab_ui|call|channel|livekit_[a-z]+|zeta_prompt|cloud_llm_client|cloud_api_types|cloud_api_client|git_hosting_providers|docs_preprocessor|edit_prediction_cli|eval_cli|eval_utils|theme_importer|schema_generator|remote_server|benchmarks|extension_cli)/'
```

1453 lines across the crates that can reach a running IDE. Most are paths,
identifiers and comments inside strings. Narrowing to prose — a string
containing `Zed` and a space — gives **222 unique strings**, distributed:

| Crate | Prose strings | Reachable? |
| --- | --- | --- |
| `settings_ui` | 23 | yes, every settings page description |
| `language_models` | 21 | mostly Zed's cloud provider, unregistered |
| `zed` | 20 | yes: menus, launch failure, macOS prompts |
| `agent_ui` | 13 | partly; several are Zed-agent-only arms |
| `settings` | 12 | yes, `BaseKeymap` display strings included |
| `ai_onboarding` | 11 | no, Zed Pro upsell only |
| `migrator` | 8 | yes, settings-migration notifications |
| `cli` | 8 | yes, `knightcode-ide` CLI output |
| `workspace`, `ui` | 7 each | yes; `workspace` is off-limits, hide instead |
| `remote`, `onboarding`, `gpui` | 6 each | mixed |
| remaining 20 crates | 2–4 each | mixed |

Assets, which the user can open directly:

| File | Hits | Note |
| --- | --- | --- |
| `assets/settings/default.json` | 68 | `zed: open default settings` shows it |
| `assets/settings/initial_user_settings.json` | 4 | the first file a user ever opens |
| `assets/keymaps/*.json` | 14 | headers and comments |

Brand artwork that is still Zed's mark, by content rather than by name:
`assets/images/zed_logo.svg`, `assets/icons/ai_zed.svg`,
`assets/icons/zed_agent.svg`, `zed_agent_two.svg`, `zed_predict.svg` and
its four variants. The application icons were already replaced by
`apps/desktop/scripts/generate-icons.py` in WP04; the in-UI marks were not,
because nothing generates an SVG.

The command palette is a special case worth naming. It renders every action
through `command_palette::humanize_action_name`
(`crates/command_palette/src/command_palette.rs:738`), so `zed::About`
reads `zed: about`. Every other display path — the keymap editor at
`crates/keymap_editor/src/keymap_editor.rs:1733`, `:2556`, `:2858`, and
which-key at `crates/which_key/src/which_key.rs:70` — calls the same
function. One prefix substitution there fixes all of them. Renaming the
namespace itself would touch every `#[action(namespace = zed)]`, every
keymap asset and every user keymap, and would conflict on every upstream
merge for the rest of the fork's life. It is not worth it, and the JSON
value is a config file rather than a surface.

### 6. Process names

Windows is already clean: WP04 and WP05 ship `KnightCode.exe`,
`bin\knightcode-ide.exe` and `engine\knightcode-engine.exe`. The other two
are not:

- `script/bundle-mac:307` copies the binary to `Contents/MacOS/zed`, and
  `:216` signs that path. Activity Monitor and the Force Quit dialog show
  it.
- `script/bundle-linux:110` copies it to `libexec/zed-editor`. `ps` shows
  it.

Both are bundle-script lines. Renaming the cargo bin target instead would
change CI, both other bundle scripts, `Cargo.toml`, the fork's docs and
every upstream merge; WP04 excluded it for that reason and this work
package keeps that exclusion. Copying to a different name at bundle time
gets the same result for the user in three lines. The dependants that read
the name are `crates/zed/resources/info/*.plist` (`CFBundleExecutable`),
`crates/zed/resources/zed.desktop.in` (`Exec`), `script/install-linux`, and
`crates/auto_update_helper`'s job list, which WP05 already taught the
KnightCode names.

### 7. Licensing

The fork is `GPL-3.0-or-later` (`crates/zed/Cargo.toml:7`) and both
repositories are public, so source availability is satisfied. The engine is
MIT (`package.json:4`), which is GPL-compatible, and it is a separate
process reached over loopback HTTP and stdio in any case.

What is missing is the notice GPL-3 §5(a) and §5(b) ask of a modified
version, in the place a user looks: the About window
(`crates/zed/src/zed.rs:1595`) shows the icon, the name, the commit and the
version, and says nothing about Zed. The Windows installer already shows
`LICENSE-GPL` as its licence page (`script/bundle-windows.ps1:96`); the
`.dmg` and the tarball show nothing and ship no licence file.

`legal/` still holds Zed Industries' terms of service, privacy policy and
subprocessor list, naming "Zed Industries, Inc." and `zed.dev`. No Rust
reads them — `rg -n "legal/" --include=*.rs crates/` is empty — so they are
not shipped, but they are in a public repository under our name.

---

## Task 0 — Refresh the base

Merge upstream before a sweep, not after, so nothing is cleaned twice.

- [ ] In the fork: `git fetch upstream && git merge upstream/main`.
- [ ] Resolve conflicts only in files listed in the fork-surface table. A
      conflict anywhere else is a defect in the fork surface: record it,
      and say so in the task report rather than resolving it quietly.
- [x] Compare `acp_thread::AgentConnection` with the delegating `impl` in
      `crates/knightcode_agent/src/connection.rs`. Any method upstream
      added with a default body needs a delegation, or the default
      silently disables that feature.
- [x] `python apps/desktop/scripts/generate-icons.py <fork root> --verify`.

**Checks:** `CARGO_BUILD_JOBS=4 cargo build -p zed` exits 0.
`cargo test -p knightcode_engine -p knightcode_agent -p knightcode_models`
green. Paste the summary lines.

---

## Task 1 — No install talks to Zed Industries unless asked

Root cause is the endpoint, not the setting: a user who turns metrics back
on must not thereby start reporting to a third party. Fix the endpoint, and
fix the default that makes it live.

- [x] Add `KNIGHTCODE_TELEMETRY_ENDPOINT` beside `MINIDUMP_ENDPOINT` in
      `crates/client/src/telemetry.rs:92`, as
      `option_env!(..).or_else(env::var)`, unset in every bundle.
- [x] `build_request` uses it instead of
      `build_zed_api_url("/telemetry/events")`, and `flush_events_inner`
      returns `Ok(())` early when it is `None` — the shape
      `upload_previous_minidumps` already uses. Drop the dead
      `has_checksum_seed`, or call it; do not leave it.
- [x] `assets/settings/default.json`: `telemetry.metrics` and
      `telemetry.diagnostics` both default to `false`, with the comment
      rewritten to say what those keys now control, which is nothing.
      KnightCode's own reporting is Task 1b and does not read them.
- [x] Audit every other outbound host the same way. `rg -n "zed\.dev|
      build_zed_api_url|build_zed_cloud_url" crates/ --include=*.rs` and
      account for each live call site. Expected to remain after this task:
      the extension registry (kept on purpose, Task 7) and the
      documentation links (kept on purpose, Task 6). Everything else either
      belongs to an unregistered provider, to `collab`, or to a hidden
      action, and the task report says which for each.

**Required tests,** in `crates/client`:

- with no endpoint configured, a reported event produces no HTTP request —
  drive `Telemetry` with `FakeHttpClient` and assert zero requests;
- with an endpoint configured and `metrics` true, exactly one request goes
  to that endpoint and to nothing else.

**Manual check:** start the built IDE behind a logging HTTP proxy
(`ProxySettings`, or `HTTPS_PROXY` — note `ensure_loopback_no_proxy` keeps
the engine off it). Open a buffer, the agent panel, the settings window and
the command palette. Paste the proxy's host list. Expected:
`knightcode.dev` only, and nothing at all until the hourly update check.

---

## Task 1b — The IDE reports installs to our own PostHog

Deleting Zed's pipeline must not leave us blind on the one number that
matters at launch: how many people installed this, on what, and did they
come back for the next version. We already collect exactly that for the
CLI, anonymously, and the IDE should join the same funnel rather than grow
a second one.

**The decision that shapes this task: do not repoint Zed's pipeline at
PostHog.** It is tempting — it is one URL — and it is wrong. That pipeline
is fed by hundreds of `telemetry::event!` call sites spread across upstream
crates, sending editor actions, agent turns, onboarding steps and extension
installs, keyed by `installation_id` and `system_id`. Repointing it adopts
every one of them unreviewed, and every upstream merge silently adds more.
§12 of the architecture forbids exactly this: "telemetry from the IDE that
the CLI does not already send". So Zed's pipeline stays dead, and we write
one event we can describe in a sentence.

**Where it lives: the engine, not Rust.** The engine is already the
KnightCode half of the IDE, it already holds `SettingsManager`, it already
honours `KNIGHTCODE_OFFLINE`, and `isInstallTelemetryEnabled` is already
the shared opt-out. Putting the ping there means one setting governs both
front doors — the same principle as the shared `auth.json` — and it means
no telemetry code in Rust, so the §13 credential grep stays clean and
`crates/knightcode_*` gains no network surface. The IDE's only contribution
is telling the engine what version it is.

- [x] `crates/knightcode_engine/src/environment.rs`: add
      `IDE_VERSION_ENV = "KNIGHTCODE_IDE_VERSION"` and set it in
      `engine_environment` (`:57`), which is the one pure function that
      builds the child's environment and is already unit-tested. The value
      is `AppVersion::global(cx)` plus the release channel.
- [x] `packages/cli/src/engine/install-report.ts`, new, ~30 lines,
      modelled on `reportInstallTelemetry`
      (`interactive-mode.ts:1239`). It returns immediately unless
      `KNIGHTCODE_IDE_VERSION` is present, so nothing changes for a CLI
      user or for the ACP adapter, which exits at `engine-entry.ts:27`
      before a context exists.
- [x] Gate it on exactly what the CLI gates on: `KNIGHTCODE_OFFLINE`, then
      `isInstallTelemetryEnabled(ctx.settings)`. No new setting, no second
      opt-out, no environment variable of its own.
- [x] Fire once per IDE version, not once per start. The engine restarts —
      `KNIGHTCODE_ENGINE_PORT` pinning exists because it does — so store
      the last reported version under a new `lastIdeVersion` key in
      `SettingsManager` and compare. Store it only once the route has
      answered 2xx, so a start with no network retries next time instead of
      losing the install. Do not reuse `lastChangelogVersion`;
      that drives the CLI's changelog display and must not be moved by the
      IDE.
- [x] Call it from `engine-entry.ts` after the port line is written, as
      `void reportIdeInstall(ctx)`. Fire-and-forget with a 5 s timeout and a
      swallowed rejection, like the CLI's. The engine's readiness must never
      wait on an analytics request.
- [x] User agent `knightcode-ide/<version> (<platform>; <runtime>; <arch>)`,
      built by extending `getKnightcodeUserAgent`
      (`packages/cli/src/utils/user-agent.ts`) with a product name rather
      than copying it.

**The route.** `apps/web/app/api/report-install/route.ts`:

- [x] Accept the second user-agent shape and emit `event: "ide_install"`
      with `product: "knightcode-ide"`. Keep `cli_install` exactly as it is
      — renaming it orphans the history already in the project — and keep
      every property name identical across the two so a `product`
      breakdown works without a formula.
- [x] Add `"$geoip_disable": true` to the properties of both events. The
      `$geoip_*` set currently describes Vercel's egress IP, not the user,
      and the route already sends the true `country`, `region` and `city`
      from the edge headers. This is a correctness fix to existing data
      collection, not a new feature.
- [x] The route keeps answering 204 with `POSTHOG_KEY` unset, so a
      preview deployment reports nothing and a missing secret is never an
      outage.

**Required tests,** `apps/web`, `bun test` beside `lib/ide-release.test.ts`:

- an IDE user agent produces an `ide_install` event with the right
  `product`, `version`, `os` and `arch`, and a CLI one still produces
  `cli_install`;
- the same IP and user agent produce the same `distinct_id` twice, and a
  different IP produces a different one;
- no request body contains an IP address or the raw user agent beyond the
  parsed fields;
- with `POSTHOG_KEY` unset the route is a 204 and makes no outbound call.

**Required tests,** `packages/cli/test/engine/`, faux provider, no network:

- with `KNIGHTCODE_IDE_VERSION` absent, nothing is reported;
- with it present and `enableInstallTelemetry` false, nothing is reported;
- with it present and `KNIGHTCODE_OFFLINE=1`, nothing is reported;
- with it present and telemetry enabled, exactly one request is made, and a
  second engine start at the same version makes none.

Stub the fetch; do not let the suite reach knightcode.dev.

**Manual check:** run the built engine with `KNIGHTCODE_IDE_VERSION` set
against a local route, then confirm in PostHog that `ide_install` arrived
with the expected properties. Paste the event. Do this before 1.0 ships, not
after: an install counter discovered to be broken after launch has no
history to recover.

---

## Task 1c — Four events that say whether it worked

**Approved by the owner, 2026-09-17.** Install counts alone cannot tell a
good launch from one where most people never got past sign-in: both look
like installs. §12 of the architecture has been amended with §12.1, a closed
allowlist of five events and the rules binding them. Read it before writing
anything here; it is the contract, and adding a sixth event is an amendment
to it rather than a commit.

Beyond `ide_install` from Task 1b, four events:

| Event | When | Properties |
| --- | --- | --- |
| `ide_first_run` | first run ends, either way | outcome, last step |
| `ide_engine_failed` | engine never reached ready | reason category |
| `ide_first_turn` | first successful agent turn of a version | provider id |
| `ide_seam_first_use` | first use of a seam, per version | seam name |

**Why these live in Rust, unlike Task 1b's.** `ide_engine_failed` fires
precisely when the engine is not running, so the engine cannot report it.
First-run steps happen before the engine may even be up. So the IDE needs
its own small reporter — which means Task 1b's "no telemetry code in Rust"
holds only for the install ping, and this task is the exception. Keep it to
one module.

- [x] `crates/knightcode_engine/src/report.rs`, new and the only place in
      the fork that sends an event. A closed `enum Event` with one variant
      per row above, so a call site cannot invent an event and a reviewer
      sees the whole surface in one screen. No `&str` event names, no
      generic property map.
- [x] Every reason and seam is a closed enum too, rendered to a fixed
      string. `EngineFailure::{BinaryMissing, TokenRejected, ExitedEarly,
      Timeout, PortLineMissing}` maps from the existing `StartError`
      variants in `crates/knightcode_engine/src/process.rs` — map the
      variant, never `format!` the error, which carries a path and so a
      username.
- [x] **The consent mirror.** The shared answer lives in the engine's
      settings, which are unreachable when the engine is down — exactly
      when `ide_engine_failed` matters. So the IDE keeps a mirror in its
      `KeyValueStore`, written when first run answers the question and
      refreshed whenever the engine reports a change. **Absent means do not
      send.** A machine that has never answered reports nothing, which is
      why §12.1 accepts that abandonment on step 1 is unmeasurable.
- [x] Fire-and-forget, 5 s timeout, swallowed rejection, on a background
      task. Nothing in the IDE's startup, first run or engine lifecycle may
      wait on one of these.
- [x] `ide_seam_first_use` and `ide_first_turn` fire once per version, not
      per use. Store what has already been reported beside the consent
      mirror. This is the difference between a launch signal and usage
      tracking, and §12.1 binds it.
- [x] The route (`apps/web/app/api/report-install/route.ts`, or a sibling
      if it outgrows it) accepts the four and rejects any event name outside
      the allowlist with a 400. Server-side enforcement matters because the
      route is public: without it, anyone can write anything into the
      project.

**Required tests,** `crates/knightcode_engine`:

- with the consent mirror absent, every event is a no-op and no request is
  built — assert with `FakeHttpClient`;
- with it false, likewise;
- with it true, each event produces exactly one request, and a second call
  for a once-per-version event produces none;
- **the privacy test, which is the one that matters:** construct every
  `StartError` variant with a path containing a username, map it, and assert
  the resulting payload contains neither the path nor the username. Then
  assert the serialised payload of every event variant matches an expected
  fixture exactly, so adding a property is a test change someone has to
  look at.

**Required tests,** `apps/web`:

- each allowlisted event name is accepted; an unlisted one is a 400 and
  nothing reaches the sink.

**Manual check:** complete first run on a clean machine, then abandon it on
a second; delete the engine binary and start the IDE on a third. Confirm in
PostHog that the three events arrived, and that no property contains a path,
a username or a machine identifier. Paste the three events.

---

## Task 2 — No API-key field in the IDE belongs to Zed

- [x] Delete the `register_compatible_providers` call from
      `LanguageModelRegistry`'s settings observer in
      `crates/language_models/src/language_models.rs`, and the function
      with it. The fork-surface row for this file already covers the
      registration body; widen its description.
- [x] Hide the **Add Provider** button:
      `crates/settings_ui/src/pages/llm_providers_page.rs:73`. New
      fork-surface row.
- [x] Correct `architecture.md` §13: the grep expectation is one
      `register_provider` call in that file, and after this task that is
      true.

**Required tests,** `gpui`, in `crates/language_models`:

- with `language_models.openai_compatible` naming two providers in the
  settings store, the registry holds exactly one provider after
  `language_models::init`, and its id is KnightCode's;
- no code path in the fork links `credentials_provider` — keep this as the
  §13 grep, run in the task's checks.

**Manual check:** open Settings > AI. Paste what the Providers section
shows. Expected: KnightCode, signed in or offering to sign in, and no way
to add another.

---

## Task 3 — The first-run screen

New crate `crates/knightcode_onboarding`, additive, in the fork-surface
table as a new row. It owns a `FirstRun` workspace item and one action,
`knightcode::ShowFirstRun`.

Four steps, in the order §6.2 and §10 fix:

1. **Welcome.** The KnightCode mark, the product name, the version, and one
   line saying what it is. Theme (light/dark/system) and base keymap, which
   are the two choices a new user regrets not making; both write settings
   through `SettingsStore` exactly as Zed's basics page does. Plus one
   switch, defaulted on to match the CLI: "Send an anonymous ping when
   KnightCode is installed or updated", with a sentence naming exactly what
   it contains — version, OS, architecture, and an approximate location from
   the connecting address — and saying it carries no account, no file and no
   identifier. It writes through Task 4's settings route, so the CLI and the
   IDE share one answer rather than disagreeing. Wording it vaguely here
   would be worse than not asking.
2. **Sign in.** `SignInView`'s state machine, presented full-width. The
   buttons come from `GET /v1/accounts`' `login_options`, ordered Claude,
   ChatGPT, Copilot, then the rest, then API key — ordered by the engine's
   list, not by a table in Rust. **Skipped entirely when
   `state.accounts` is non-empty**, per §6.3, with a line saying which
   account was found.
3. **Pick a model.** Task 4's picker. Not skippable when no model is
   recorded, because three surfaces are dead without one; skipped, with the
   current choice shown, when the engine already reports a default.
4. **Open something.** "Open a folder…", "Clone a repository…", and
   "Skip for now". Finishing writes `FIRST_OPEN` and closes the item.

- [x] Replace the stopgap at `crates/zed/src/main.rs:1584` with
      `knightcode_onboarding::show_first_run(app_state, cx)`, keeping the
      `FIRST_OPEN` write so the branch is taken once. Delete the stopgap's
      comment; it describes work that is now done.
- [x] Add `zed_actions::OpenOnboarding` and `onboarding::ShowWelcome` to
      the hide list at `crates/zed/src/main.rs:737`, with `zed::GetMerch`
      and `zed::OpenAccountSettings`.
- [x] `crates/zed/src/zed/app_menus.rs:309`: Help > Show Welcome becomes
      Help > Welcome to KnightCode, dispatching `ShowFirstRun`.
- [x] Do not touch `crates/onboarding` or `crates/workspace`. Both stay
      compiled and unreachable; that is cheaper on every merge than
      deleting them, and the hide list is the thing under test.

**Required tests,** `gpui`, in `crates/knightcode_onboarding`:

- with a fake engine reporting one account and a default model, first run
  opens on step 1 and both step 2 and step 3 report themselves satisfied;
- with a fake engine reporting no accounts, step 2 renders one button per
  `login_option` in the engine's order, and Continue is disabled until an
  account appears;
- with an account but no default model, step 3 is reachable and Finish is
  disabled until a model is chosen;
- finishing writes `FIRST_OPEN`.

Plus, in `crates/zed`: a test that asserts the hidden action set contains
`OpenOnboarding`, `ShowWelcome`, `GetMerch` and `OpenAccountSettings` —
that list has grown by accident before, and a test is cheaper than a walk.

**Manual check:** delete the `FIRST_OPEN` key from the local database and
start the IDE. Screenshot each step. Expected: no Zed logo, no "Welcome to
Zed", no zed.dev link on any of the four.

---

## Task 4 — Recording the model choice, both halves

**Engine.** A new route in `packages/cli/src/engine/models.ts`:

- [x] `PUT /v1/models/default`, body `{ ref }`. Rejects a `ref` that is not
      in `getAvailable()` with 400 — never writes a model the user cannot
      reach. Splits the ref on the first `/` only, since model ids contain
      slashes.
- [x] Writes through `ctx.settings.setDefaultModelAndProvider`
      (`packages/cli/src/core/settings-manager.ts:765`), which is the same
      call the CLI's own picker makes, so both front doors agree.
- [x] Emits `models.changed` on `/events`. The Rust side already listens:
      `EngineEvent::ModelsChanged` triggers `State::refresh_quietly`
      (`crates/knightcode_models/src/state.rs:58`), so the picker
      repopulates with no extra wiring.
- [x] `ctx.settings.reload()` before the write, for the same reason the GET
      handler reloads: the CLI may have moved it since startup.

And, because first run needs to write one more shared setting and a second
route is cheaper than a second settings store:

- [x] `GET` and `PUT /v1/settings/telemetry`, body `{ enabled }`, reading
      and writing `enableInstallTelemetry` through the same
      `SettingsManager` the engine already holds. `GET` reports the
      effective value, so a `KNIGHTCODE_TELEMETRY` environment override is
      visible to the switch rather than silently contradicting it; `PUT`
      when that override is set returns 409 and says so, because writing a
      setting the environment outranks would be a lie to the user.

**Required tests,** `packages/cli/test/engine/`, faux provider, no session:

- a `PUT` with a ref from `GET /v1/models` makes the next `GET` return it
  as `default`;
- `PUT /v1/settings/telemetry` with `false` makes Task 1b's report a no-op,
  and `GET` reflects it;
- with `KNIGHTCODE_TELEMETRY=0` in the environment, `GET` reports disabled
  and `PUT` is a 409;
- a `PUT` with an unknown ref is a 400 and changes nothing;
- a `PUT` emits exactly one `models.changed` on `/events`;
- the route rejects a missing or wrong bearer token before routing, like
  every other route;
- the write lands in the same settings file the CLI reads — open it with a
  second `SettingsManager` and assert.

**IDE.**

- [x] `EngineClient::set_default_model(&self, reference: &str)` in
      `crates/knightcode_engine/src/client.rs`.
- [x] `State::set_default_model` in
      `crates/knightcode_models/src/state.rs`, optimistic-free: it calls,
      then lets `models.changed` refresh. Correct the doc comment at `:81`,
      which currently says the IDE does not pick the model.
- [x] A picker component, used twice: by first run step 3 and by the
      KnightCode section of Settings > AI. Grouped by provider, the way
      `toConfigOptions` groups them, so the two agree.

**Required tests,** `gpui`, `crates/knightcode_models`:

- choosing a model calls the client once with the provider-qualified ref;
- a `ModelsChanged` event after it leaves `default_model` reporting the new
  model;
- with no default recorded, `default_model` is `None` and nothing in the
  fork invents one.

**Manual check,** which is the point of the whole task: on a machine whose
`~/.knightcode` has no settings file, sign in through first run, pick a
model, then exercise Cmd+K in a buffer, Cmd+K in the terminal, and a
generated commit message. Paste what each produced. This is the check that
would have caught the gap.

---

## Task 5 — The brand mark in the UI

- [x] Produce `knightcode-mark.svg` — a single-path monochrome mark that
      reads at 16 px, derived from `apps/web/public/knightcode-icon.png`.
      Extend `apps/desktop/scripts/generate-icons.py` to emit the sized PNG
      variants from it so there is one source for every icon, and add the
      SVG to `apps/web/public/` so the website and the IDE share it.
- [x] Replace the contents of `assets/images/zed_logo.svg`,
      `assets/icons/ai_zed.svg`, `assets/icons/zed_agent.svg`,
      `zed_agent_two.svg`, `zed_predict.svg`, `zed_predict_disabled.svg`,
      `zed_predict_up.svg`, `zed_predict_down.svg`, `zed_predict_error.svg`
      and `zed_src_custom.svg`. **Keep the file names.** They are internal
      identifiers behind `IconName` and `VectorName`, nothing renders them,
      and keeping them means every one of the 40-odd call sites is fixed by
      the file change alone and no merge conflicts are created. Add a row
      to the fork-surface table: on conflict, keep ours.
- [x] `zed_assistant.svg` is a generic sparkle, not a mark. Leave it.
- [x] `crates/zed/resources/*.png`, `*.ico`, `Document.icns` are already
      ours; re-run `generate-icons.py --verify` after the source change.

**Check:** open the agent panel, the Tab status-bar button, the model
selector and the first-run screen and screenshot each. Expected: the
KnightCode mark, at the right weight, in both the light and the dark
default themes.

---

## Task 6 — The string sweep

Work surface by surface, not file by file, and decide per surface between
rewriting the string, hiding what draws it, and leaving it because it is
unreachable. Record the decision in the task report for every surface.

- [x] **The first file a user opens.**
      `assets/settings/initial_user_settings.json` — all four lines,
      including the `zed: open default settings` instruction, which becomes
      the relabelled command.
- [x] **`assets/settings/default.json`** — 68 hits. Comments, the
      `server_url` default, the telemetry comments from Task 1, and the
      settings-profile example at the end.
- [x] **`assets/keymaps/*.json`** — headers and comments, 14 hits.
- [x] **The application menu.** `crates/zed/src/zed/app_menus.rs:106` "Hide
      Zed" and `:112` "Quit Zed". `:318` Documentation keeps its URL and
      becomes "Editor Documentation (Zed)", per the owner's answer.
- [x] **The command palette.** One substitution in
      `command_palette::humanize_action_name`
      (`crates/command_palette/src/command_palette.rs:738`): a leading
      `zed::` displays as `knightcode:`. New fork-surface row. This also
      fixes the keymap editor and which-key, which call the same function;
      assert that in a test rather than assuming it.
- [x] **`BaseKeymap`.** `crates/settings/src/base_keymap_setting.rs:58`,
      `:76` and `:88` — "Zed" and "Zed (Default)" become KnightCode's. The
      serialized value stays `"Zed"`; it is a settings value, not a
      surface, and changing it breaks every existing settings file for no
      visible gain.
- [x] **`crates/settings_ui/src/page_data.rs`** — 23 prose descriptions,
      every one of them displayed.
- [x] **`crates/settings_ui/src/settings_ui.rs:894`** — the settings window
      title reads "Zed — Settings".
- [x] **macOS-only prompts.** `crates/zed/src/zed/move_to_applications.rs`
      (six strings, shown on first launch from a `.dmg`) and
      `crates/zed/src/zed/mac_only_instance.rs:75`–`:78`.
- [x] **Launch failure.** `crates/zed/src/main.rs:92` and `:174`, the first
      thing a user sees when it does not start.
- [x] **The HTTP user agent.** `crates/zed/src/main.rs:502` sends
      `Zed/{version}`.
- [x] **`crates/migrator`** — 8 settings-migration notifications.
- [x] **`crates/cli`** — 8 strings in `knightcode-ide`'s own output.
- [x] **`crates/zed/src/zed/quick_action_bar/repl_menu.rs:377`** — "Setup
      Zed REPL for {language}".
- [x] **The rest.** Work the inventory in §5 of Design down to zero
      reachable hits. For each surface you leave, say in the report why it
      cannot be reached; "probably unreachable" is not an answer, and
      `ai_onboarding` and `language_models/provider/cloud.rs` in particular
      need the registration argument spelled out.

**The gate, which is the deliverable here as much as the strings are.** Add
`script/check-branding.sh` and run it in the fork's pull-request workflow
(`.github/workflows/knightcode.yml`, added by WP05):

- the scan in §5 of Design, minus an allowlist file of the hits we keep on
  purpose, each with a one-line reason;
- a non-empty diff means a new Zed string reached a live crate, and the job
  fails naming it.

Upstream merges will add rows to that allowlist, and that is the point: a
merge that introduces a new user-visible Zed string becomes visible instead
of silent.

**Manual check:** open the command palette and type "zed". Paste the
result. Expected: nothing, except actions whose own names we chose.

---

## Task 7 — Extensions, credited

Per the owner's answer the page keeps working against `api.zed.dev`.

- [x] Rewrite the 41 hits in `crates/extensions_ui/src/extensions_ui.rs`:
      the "… support is built-in to Zed!" suggestions become KnightCode's,
      keeping their `zed.dev/docs` links under Task 6's relabelling.
- [x] `crates/extensions_ui/src/components/extension_card.rs:362` — "not
      compatible with this version of Zed".
- [x] Add one line to the top of the extensions page: extensions come from
      the Zed extension registry, and installing one sends a request to
      `zed.dev`. It is true, it is the only outbound third-party call an
      install makes, and a user is entitled to know before they click.

**Check:** open the extensions page with the proxy from Task 1 running.
Paste the host list. Expected: `api.zed.dev` and nothing else, and only
after the page is opened.

---

## Task 8 — Attribution, licensing and process names

- [x] **About window** (`crates/zed/src/zed.rs:1595`): below the version,
      a line reading that KnightCode is built on Zed, is licensed
      GPL-3.0-or-later, and is not affiliated with or endorsed by Zed
      Industries; with a link to the upstream repository and one to ours.
      That is what GPL-3 §5(a) and §5(b) ask for, in the place a user
      looks, and it is the sentence that makes "a Zed-based IDE" true
      rather than implied.
- [x] **A `NOTICE` file** in the fork root listing Zed (GPL-3.0-or-later),
      `gpui` and the Apache-2.0 components, the bundled themes'
      licences from `assets/themes/LICENSES`, and the engine's MIT licence.
      Ship it in all three payloads.
- [x] **`.dmg` and tarball ship `LICENSE-GPL` and `NOTICE`.** The Windows
      installer already shows the licence
      (`script/bundle-windows.ps1:96`); the other two show nothing.
- [x] **`legal/`**: replace `terms.md`, `privacy-policy.md` and
      `subprocessors.md`, which are Zed Industries', with KnightCode's or
      with a pointer to knightcode.dev. They are not shipped, but they are
      in a public repository under our name and they name another company.
- [x] **Process names.** `script/bundle-mac:307` copies to
      `Contents/MacOS/KnightCode` and `:216` signs that path;
      `script/bundle-linux:110` copies to `libexec/knightcode`. Then follow
      every reader: `crates/zed/resources/info/*.plist`
      (`CFBundleExecutable`), `crates/zed/resources/zed.desktop.in`
      (`Exec`), `script/install-linux`, `script/install.sh`,
      `script/uninstall.sh`, `crates/cli/src/main.rs`'s resolution of the
      app binary, `crates/util/src/util.rs`'s launcher name for git
      askpass, and `crates/auto_update_helper`'s job list. Missing one of
      these breaks the launcher or the updater, so grep for both old names
      and account for every hit. The cargo bin target stays `zed`; WP04
      excluded renaming it and that stands.

**Checks:** `cargo build -p zed` clean. On macOS, `bundle-mac` produces an
`.app` whose `Contents/MacOS/` holds `KnightCode` and `engine/`, it
launches, and Activity Monitor names it KnightCode. On Linux, `bundle-linux`
produces a tarball whose `libexec/` holds `knightcode` and `engine/`, and
`install-linux` then `knightcode-ide` starts it. Paste both trees.

---

## Task 9 — Launch readiness

- [x] **A download page** on knightcode.dev. The five installers of the
      newest published release, from the same GitHub Release
      `apps/web/app/api/ide` already reads, with per-platform instructions
      that name the SmartScreen and Gatekeeper warnings §14 describes and
      say what to click. An unsigned installer with no explanation reads as
      malware.
- [x] **IDE documentation** at knightcode.dev/docs: install, first run,
      signing in, picking a model, where the engine lives and the two
      settings that move it, updates, and how to file a bug. The editor
      reference stays Zed's, linked and labelled. `apps/web/content/docs/`
      gets an `ide/` section; the existing docs are the CLI's and stay.
- [x] **Move `crates/zed/KNIGHTCODE_REF`** to a current commit of this
      repository. It is at `685e9c1a68`; `main` is well past it, and the
      ACP session reopen work merged in #176 ships only when it moves.
- [ ] **Version 1.0.0.** Run the release workflow with `bump: major` and
      `prerelease: true` first. Install the prerelease on a clean machine
      before publishing anything.
- [ ] **One PostHog dashboard** before the announcement, not after: installs
      per day broken down by `product`, so CLI and IDE sit side by side; by
      `os` and `arch`, which is how the next platform gets prioritised; and
      by `version`, which is the only evidence that the updater in WP05
      actually moves people. Plus the funnel Task 1c exists for:
      `ide_install` to `ide_first_run` completed to `ide_first_turn`. If the
      middle step collapses on launch day, that chart is how you find out in
      hours rather than from a complaint in a fortnight. A launch with no
      dashboard is a launch whose result nobody can state a week later.

**The validation debt this phase inherits, all of it owed before launch:**

- the clean-machine Windows install (WP04 Task 5 Step 4): a machine with no
  Bun, no Node, no npm and no CLI installs, signs in, and completes an
  agent turn;
- the macOS and Linux installs, which CI has built and signed since
  `v0.1.1-rc.2` but which no one has run;
- the update walk on macOS and Linux (WP05, Owed);
- the model-surface walk from WP03's Validation, on an account with quota:
  a panel prompt and the three WP02 scenarios, Cmd+K in a buffer, Cmd+K in
  the terminal, a commit message, Tab. Task 4's manual check covers the
  clean-machine half of this; this is the with-quota half.

---

## Exclusions

Do not add in this work package:

- a rename of the `.zed` project settings folder, or a second folder read
  beside it — the owner chose compatibility, and
  `crates/paths/src/paths.rs:487` stays as it is;
- a proxy or mirror for the extension registry, or any replacement for
  `api.zed.dev/extensions`;
- a port of Zed's documentation, or a rewrite of the editor reference;
- a rename of the `zed` cargo bin target, of any crate, or of the
  `zed::` action namespace in keymaps, settings or JSON — display-only, per
  Design §5;
- edits to `crates/onboarding` or `crates/workspace`; Zed's onboarding and
  welcome pages are hidden, not modified, and `workspace` is off-limits;
- a session browser, an agent-manager UI, or any surface §12 excludes;
- a signing certificate, an Apple Developer account, or a change that
  weakens the guards that skip signing when they are absent — §14 stands
  and v1 ships unsigned;
- any change to the CLI's system prompt, tool definitions, agent loop or
  `packages/ai`; the only engine change here is Task 4's route;
- a hard-coded model list or a per-provider default table, in either half;
- any telemetry beyond the five events in architecture §12.1 — specifically:
  no repointing of Zed's `telemetry::event!` pipeline at PostHog or anywhere
  else, no sixth event without amending §12.1 first, no `posthog-js` on
  knightcode.dev, no PostHog write key in the IDE binary or in any Rust
  crate, and no revival of `enableAnalytics` or `trackingId`;
- telemetry code in Rust outside the single module in Task 1c; the install
  ping stays in the engine, where the shared opt-out already lives;
- any property carrying a path, a project name, buffer or prompt text, a
  file name, an error message, a model id, an account or a machine id;
- anything in `editor`, `project`, `workspace`, `terminal`, `git`, `vim` or
  `gpui`.

---

## Validation

In this repository:

```bash
bun run check-types
cd packages/cli && bun x vitest --run test/engine
cd apps/web && bun test
```

In the fork:

```powershell
$env:CARGO_BUILD_JOBS = "4"
cargo build -p zed
cargo test -p knightcode_engine -p knightcode_agent -p knightcode_models `
  -p auto_update -p auto_update_helper -p settings -p release_channel
# Separate invocations: see the CI note in the implementation report.
cargo test -p knightcode_onboarding
cargo test -p client -p language_models -p command_palette
cargo test -p zed --bin zed hidden_action
cargo fmt -p <each touched crate> -- --check
bash script/check-branding.sh
```

Then the greps §13 names, with their corrected expectations:

```bash
rg -n "api_key|API_KEY|Bearer |auth\.json|credential" \
  crates/knightcode_agent crates/knightcode_models crates/knightcode_engine \
  crates/knightcode_onboarding
rg -n "register_provider" crates/language_models/src/language_models.rs
```

Expected: the launch token only, and one `register_provider` call.

---

## Stop condition

This work package is done when §15 of the architecture is true and the
following are each backed by evidence in the task reports:

- a clean machine installs the IDE, is walked through sign-in and model
  choice without a terminal, and lands in a project;
- the agent panel, Cmd+K in a buffer, Cmd+K in the terminal, commit
  messages and Tab are all served by that one login and that one model
  choice;
- no surface reaches a provider dialog, an API-key field belonging to Zed,
  or a zed.dev account;
- an install running behind a logging proxy contacts `knightcode.dev` and
  nothing else, until the user opens the extensions page;
- an `ide_install` event has been observed in PostHog project 596276 from a
  real install, carrying version, OS and architecture and no identifier,
  and turning the switch off in first run stops it;
- `ide_first_run`, `ide_engine_failed` and `ide_first_turn` have each been
  observed from a real machine, no event carries a path or a username, and
  the fixture test that pins every payload passes;
- `script/check-branding.sh` passes, and its allowlist is short enough to
  read;
- the About window credits Zed, names the licence, and disclaims
  affiliation; `NOTICE` and `LICENSE-GPL` ship in all three payloads;
- macOS and Linux installs have been run, updated, and screenshotted by
  someone with the hardware;
- 1.0.0 is published, and the download page serves it.

---

## Implementation report

Written 2026-09-18, after implementing Tasks 0 through 9. Everything below was
verified by running something; where a claim is a measurement, the command that
produced it is named.

### What was found by running the code, not by reading it

Four outbound call sites the plan's audit did not name, three of them fixed.

1. **Startup sign-in to the upstream collaboration service.**
   `crates/zed/src/main.rs` spawned `authenticate` on every launch, which
   called `sign_in_with_optional_connect` whenever a credential for
   `server_url` happened to be in the OS keychain. A machine that also has the
   upstream editor installed has that credential, so KnightCode would open a
   connection to a third party at startup for a login it never offers. The
   spawn and the function are gone; KnightCode's only login is the engine's.
2. **An extension-update check on every clean start.**
   `ExtensionStore` refreshes at init, and `fetch_extensions_with_update_available`
   asked the registry which of *no* extensions had updates. Guarded: an empty id
   list returns early. This is also simply correct upstream.
3. **`auto_install_extensions` defaulted to `{"html": true}`,** so a fresh
   install downloaded an extension from `api.zed.dev` before the user had seen
   the Extensions page. Now empty, with the reason in the comment.
4. **The ACP agent registry, still open.** See *Owed* below.

### Deviations from the plan, and why

- **Task 0's upstream merge was not done.** The fork had no `upstream` remote
  configured, so the step as written could not run. Adding one is cheap — the
  fork carries Zed's full history, and on 2026-09-18 `upstream/main` was 124
  commits past the base `a57ba9b`, a fetch of seconds. A trial
  `git merge-tree` showed five conflicts against the committed fork, all in
  fork-surface files (`Cargo.lock`, `language_models.rs`, `crates/zed/Cargo.toml`,
  `crates/zed/src/main.rs`, `script/bundle-linux`), and 23 upstream-changed
  files that this work package also edits, so the merge follows this work as
  its own change, with the branding gate catching any new string. Upstream did
  not touch `acp_thread/src/connection.rs`. The rest of Task 0 was done: all 32
  `acp_thread::AgentConnection` methods are delegated in
  `crates/knightcode_agent/src/connection.rs` (checked by comparing the trait's
  method list against the impl's), and `generate-icons.py --verify` passes.
- **`KNIGHTCODE_IDE_VERSION` carries `AppVersion::global(cx)` verbatim,** not
  "version plus channel". `AppVersion::load` already puts the channel's
  `dev_name` in the build metadata, so the value reads `1.0.0+stable.<sha>`. It
  also has to be a user-agent version, which cannot contain a space.
- **`EngineFailure` has six variants, not the plan's five.** The plan guessed
  at `StartError`'s shape. The real variants are `Spawn`, `ExitedBeforeReady`,
  `Stalled`, `TokenRejected` and `Io`, plus the `locate_binary` failure that
  happens before a process exists. They map to `BinaryMissing`, `SpawnFailed`,
  `ExitedEarly`, `Timeout`, `TokenRejected`, `Unreachable`. There is no
  `PortLineMissing`: a missing port line surfaces as `Stalled`.
- **`ide_first_turn`'s provider comes from `Engine::default_provider`,** a
  field `knightcode_models::State` refreshes from the catalog. The agent panel
  lives in a crate with no other reason to know the catalog, and reaching the
  provider registry from there would have meant a new crate dependency for one
  string.
- **Both brand sources are kept.** The plan asked for one source for every
  icon. The application icon still comes from the full-colour
  `knightcode-icon.png` — it renders at 512 px and up, where colour is the
  point — and the in-UI marks come from the new `knightcode-mark.svg`, because
  `gpui` renders an icon as a mask that the theme colours, so a colour source
  is discarded and a detailed one turns to mud at 16 px. One script owns both.
- **`zed_predict_up/down/error/disabled.svg` keep their arrows.** Replacing all
  five prediction icons with the same mark would make "shown", "accepted",
  "rejected", "failed" and "off" indistinguishable in the status bar, which is
  the only place they appear. The mark replaces the Zed glyph in each; the
  decoration beside it stays and is generated from one table.
- **The CI test job is four steps, not one.** `project/test-support` turns on
  `remote/test-support`, whose `Mock` connection variant is only matched by
  `workspace` compiled with its own test-support. Which crates end up with
  which half of that pair depends on who else is in the same cargo invocation,
  so `knightcode_onboarding` has to be tested alone, and `client`,
  `language_models` and `command_palette` together but apart from the
  KnightCode crates. Pre-existing; the split avoids it. Adding a package to the
  wrong step fails with a non-exhaustive match in `remote_connection` rather
  than with a test failure, so the workflow says so.
- **`crates/settings_ui/src/pages/llm_providers_page.rs` is not deleted.** The
  Add Provider button is not rendered and the form is unreachable, but the
  module stays compiled behind a file-level `allow(dead_code)`, which is
  cheaper on every merge than deleting several hundred lines of upstream code.
- **The mark was redrawn after a first look (owner, 2026-09-18).** The first
  `knightcode-mark.svg` was drawn by hand and did not read as a knight. It is
  now the website's knight, from the trace in
  `packages/ai/src/auth/oauth/oauth-page.ts` that the CLI's terminal logo also
  comes from, and first run's header shows the full-colour logo rather than a
  mask.
- **The default layout is Zed's editor preset (owner, 2026-09-18).** File tree,
  outline, git and collaboration panels on the left; agent panel and threads
  sidebar on the right. It matches `PanelLayout::EDITOR` exactly, so the title
  bar's layout toggle still recognises it.

### The branding gate

`script/check-branding.sh` scans every crate a running IDE can reach for a
string literal containing `Zed ` and fails on anything not in
`script/branding-allowlist.txt`. It also fails on a *stale* allowlist entry, so
the file cannot rot into a list of reasons for strings that are gone.

The sweep took the count from **178 to 81**, and every one of the 81 is
allowlisted with a reason in one of five kinds: unreachable (with the argument
given), off-limits crate, identifier (a font family, theme name or settings
value), third party named accurately, or test code the filters miss.

Verified that the gate fails: adding a file containing `"Zed is great
software"` to `crates/zed/src/` made it exit 1 naming that file.

### Evidence

```text
bun run check-types                         clean
packages/cli   bun x vitest --run test/engine   23 files, 180 tests, 0 failed
apps/web       bun test                          4 files,  48 tests, 0 failed
fork  cargo test -p knightcode_engine -p knightcode_agent \
        -p knightcode_models -p auto_update -p auto_update_helper \
        -p settings -p release_channel            all green
fork  cargo test -p knightcode_onboarding             all green (4)
fork  cargo test -p client -p language_models \
        -p command_palette                        all green (24/20/89)
fork  cargo test -p zed --bin zed hidden_action       all green (1)
fork  cargo fmt -p <each touched crate> -- --check   clean
fork  cargo build -p zed                             clean
fork  bash script/check-branding.sh        81 hits, all allowlisted
      python apps/desktop/scripts/generate-icons.py <fork> --verify   clean
```

A debug build was started on a throwaway `--user-data-dir` and left running for
25 seconds without exiting. Its `logs/telemetry.log` was created and **empty**.
That shows `telemetry.metrics` defaulting off, not the endpoint guard: a debug
build flushes every second and writes the log before the endpoint check
(`telemetry.rs:693` against `:701`), so an empty file means nothing was queued.
The guard itself is evidenced by its unit tests.

### Owed

- **The upstream merge** (Task 0), as its own change after this one.
- **The ACP agent registry fetches at startup.**
  `project::AgentRegistryStore::init_global`, called from
  `crates/zed/src/main.rs`, refreshes on a clean profile and downloads
  `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` plus
  around fifty icon SVGs. Found by listing a throwaway profile after a run.
  This contradicts §15's "contacts knightcode.dev and nothing else, until the
  user opens the extensions page". It is **not** fixed here, deliberately: the
  only levers outside `crates/project` (which is off-limits) are to stop
  installing the global at startup, which leaves the external-agent list empty
  until someone opens the Agent Registry page, or to drop external ACP agents
  altogether. Both are product decisions of the same kind the owner already
  made for the extension registry, and belong to them.
- **The manual checks that need a GUI or another machine**: first-run
  screenshots, the logging-proxy host list, the Settings > AI walk, the
  with-quota model-surface walk, and the macOS and Linux bundle trees.
- **Observing the five events in PostHog** from a real install, and the
  dashboard that reads them.
- **1.0.0 itself.** `crates/zed/KNIGHTCODE_REF` points at `b39b16adfe`, the
  commit that completes this work package's engine half (`PUT
  /v1/models/default`, `/v1/settings/telemetry` and the install ping). The
  release workflow takes the engine commit as an input and overwrites the file,
  so pass that commit or a later one; an IDE released against an older engine
  has a model picker that 404s.
- **Deploy the website before releasing the IDE.** The route on knightcode.dev
  predates this work: a dev run on 2026-09-18 landed in PostHog as a
  `cli_install` with the IDE's version and no OS, and launch signals are not
  recorded at all until the new route is live.
- **`ide_first_run` loses its step.** The IDE sends `outcome` and `step`; the
  route records one property per event, so `step` is dropped and abandonment
  cannot be located. `LAUNCH_EVENTS` needs a list of properties per event.
- **Dev builds report themselves as stable.** A debug build's version reads
  `0.1.2+stable.<sha>`, so a developer's runs count as real installs.
- **The provider sanitiser keeps a path's letters.**
  `a_provider_id_cannot_smuggle_anything_through` pins
  `C:/Users/ada/Anthropic?x=1&y=2` becoming `cusersadaanthropicx1y2`, so a
  username reaches the wire. Catalog provider ids are safe; a user-named custom
  provider is not. Send the id only when it is already a plain lowercase id.
- **Two Zed tests cannot run.** `test_open_paths_action` and
  `sidebar_tests::test_focused_thread_tracks_user_intent` panic during setup:
  `knightcode_agent.rs:87` calls `knightcode_engine::global(cx)`, which no test
  installs. `connect` should return an error when the engine is absent.
- **A residual §15 gap recorded rather than hidden**:
  `edit_predictions.provider: "zed"` is still an accepted settings value and
  Settings still describes it as "Zed Predictions". It needs a zed.dev account
  to do anything and KnightCode never offers one, but it is a settings path to
  a third-party account. Removing the provider is a behaviour change this work
  package did not take on; the allowlist entry says so in as many words.
