# KnightCode Bots — MVP design

Status: draft, awaiting owner approval
Date: 2026-11-01

**Goal:** KnightCode Bots gives every KnightCode user always-on AI teammates.
Each bot has one continuous conversation, its own memory and routines, and a
real computer (browser, terminal, files). Bots work in the background, report
back with results, and ask only when they need information, judgment, approval
or a protected input such as a password. It is a full product, not a demo:
people use one KnightCode app for coding and for every other kind of agentic
work.

**Who it is for:** people who already use KnightCode and are signed in to
their model providers. They connect those accounts in one step and start
creating bots. The tasks are general, not only coding: reviewing and triaging
pull requests, answering email, SEO and outreach work, posting to social
accounts, and whatever a non-developer (an HR team, say) hands them.

**Architecture:** A separate platform at `bots.knightcode.dev`, built on
Cloudflare. Each bot is a Durable Object running the KnightCode agent loop
through `@knightcode/durable`. Each user has one computer (a Cloudflare
Container) shared by all of that user's bots; it sleeps when idle and comes
back with its files, logins and open tabs. Users bring their own models, so
KnightCode Bots charges only for computers and storage, priced at cost. The
web app and the desktop app share one UI; the KnightCode CLI becomes a third
client after the MVP.

## 0. Mandatory reading

- `packages/durable/README.md` and `packages/durable/docs/spec.md`: the
  durable agent harness, persist and resume, extensions, tools, settings. Its
  Durable Object storage adapter is the bot runtime's foundation.
- `packages/chord/README.md`, `packages/chord/docs/spec.md`: objects,
  principals, observable state, `webSocketLink`/`acceptWebSockets`, and
  `@knightcode/chord/sqlite/cloudflare`.
- `packages/env/README.md`, `packages/env/docs/protocol.md`,
  `packages/env/docs/semantics.md`: `RemoteExecutionEnv` and the
  `knightcode-env` daemon. Both the cloud computer and the user's own PC are
  reached through it.
- `packages/mcp/src/client.ts`, `auth-provider.ts`, `oauth/`, `transports/`:
  the MCP client and its OAuth support, reused for connectors in the cloud.
- `packages/cli/src/extensions/plugins/` and
  `packages/cli/src/app-server/plugins.ts`: the plugin system (marketplaces,
  install, MCP handoff) that bot connectors build on.
- `packages/ai/src/auth/oauth/` (`anthropic.ts`, `openai-codex.ts`,
  `openai-chatgpt.ts`, `github-copilot.ts`, `xai.ts`, `device-code.ts`,
  `pkce.ts`): the provider sign-in flows the "Connect to KnightCode Bots"
  button runs again for the cloud.
- `packages/tools/src/web/`: keyless web search and fetch. It uses Node DNS
  and Bun's TLS behaviour today, so the Worker needs a fetch-based adapter.
- `apps/desktop/docs/desktop-app/architecture.md` and `desktop-shell.md`
  (section 9.2, the sidebar): where the product switcher goes.
- `apps/remote/wrangler.jsonc`: how an existing KnightCode Worker is
  configured and deployed. It is a reference for configuration only; nothing
  in this design goes through the remote relay.

## 1. Intent

Coding agents run while someone watches. Everyday work (a PR that needs a
review at 2 a.m., an inbox, a weekly SEO check, a social calendar) needs an
agent that keeps running, keeps its place, and keeps its logins. KnightCode
users already have the hard parts: model accounts and a harness they trust.
KnightCode Bots adds the durable home those agents need, inside the same
ecosystem.

Success looks like this: a KnightCode user connects their accounts once,
creates a PR-review bot and a social-posting bot in a few minutes, and a week
later both are still doing the job, remember what they were told, and come
back to a computer that is exactly as they left it, minus any page reloads.

### Goals

- Persistent bots: one continuous thread each, memory, routines, open work.
- A real computer per user that sleeps and resumes with files, logins and
  tabs intact.
- Connected accounts carry over from KnightCode with one button.
- Connectors to the user's apps, with their skills.
- Skills, including teaching a bot a task by showing it.
- Pages: documents and live dashboards bots keep current.
- An inbox across bots, proactive suggestions, and a catch-up summary.
- A vault, 1Password, passkeys, and paying with explicit approval.
- Bots that message each other, share group chats, and a Chief of Staff
  template that coordinates them.
- Reach bots from the desktop app, the web app (including on a phone),
  Telegram, Slack and email.
- Never lose work: crashes, deploys and outages resume rather than restart,
  and a retry never repeats an outward action whose outcome is unknown
  (section 24).
- Price at cost: a fixed plan, then credits at cost.

### Non-goals (MVP)

- Hosting or reselling models. Users bring their own.
- Teams and shared bots. Accounts are single-person, but data is keyed so
  teams can be added without migration (section 15).
- Native mobile apps. The web app is phone-friendly and installable.
- SMS, iMessage, WhatsApp, phone calls, voice and meeting attendance.
- A visual workflow builder. Routines stay scheduled prompts.

### Anti-goals

These would make the product a failure even if it technically works:

- It feels like a cheap knockoff: rough UI, bots that lose their place,
  connectors that break silently.
- Signing up for bots logs a user out of the KnightCode CLI.
- A bill the user did not expect, from us or from their model provider.
- An outside email, webhook or bot message can make a bot do something
  consequential that its owner never approved.
- KnightCode pays out of pocket for a user's usage.

## 2. Constraints

- Users bring their own model accounts. KnightCode never charges for AI usage
  and never marks it up.
- No hardcoded model choices. Every model the system uses (the bot's model,
  the memory helper, the approval reviewer, the group-chat judge) is chosen
  by the user. The default for every helper is the bot's own model.
- Copying credentials is forbidden. OAuth refresh tokens rotate; a copy held
  in two places logs one of them out. Only API keys may be copied
  (section 4).
- Reuse existing KnightCode surfaces. MCP sign-in, reconnect and on/off go
  through the same flows as the CLI's `/mcp`. The plugin catalog is the CLI's
  plugin system, not a second implementation.
- The agent harness is used as a library. Changes needed in
  `packages/durable`, `packages/ai` or `packages/agent` are separate,
  reviewed changes in those packages, never patches made from `apps/bots`.
- Windows parity for everything that touches the desktop app.
- The repository is public. Docs, code comments, commits and PR text
  describe behavior on its own terms. Code adapted from Apache-2.0 sources
  keeps its license header and NOTICE text, as that license requires.
- Prose in specs is wrapped at 80 columns; no emojis.

## 3. Decisions (fixed)

| Question | Decision | Rejected, and why |
|---|---|---|
| Platform | Cloudflare: Workers, Durable Objects, D1, R2, Queues, Workflows, Containers, Email Routing and Email Service, Secrets Store | A Node service with Postgres on VMs (operations work for one maintainer; scaling and failover by hand) |
| Where the agent runs | One Durable Object per bot runs `@knightcode/durable` | Inside the computer (the computer sleeps and costs money while awake; a chat should not wake it) |
| Durability and retries | Durable Objects, alarms, Queues with a dead-letter queue, Workflows for multi-step jobs | trigger.dev (a second platform and bill; the same primitives already sit next to the data) |
| Computer host | Cloudflare Containers, `durable_object` scheduling policy, one container per user | E2B now: about double the awake cost plus a $150/month plan; its memory snapshots are the planned upgrade, behind the provider layer in section 7 |
| Resume fidelity | Files, Chrome profile and open tabs survive sleep; pages reload | Memory snapshots (exact page state, half-filled forms): deferred until the cost is justified |
| Carrying over accounts | "Connect to KnightCode Bots" runs a fresh sign-in per provider and sends those tokens to the cloud; API keys are copied | Uploading `auth.json` (refreshing a copied token kills the other copy, logging the CLI out) |
| Credential storage | Envelope encryption: a per-user data key, wrapped by a key-encryption key in Secrets Store | One global key (one leak exposes everyone); a hosted vault vendor (an extra dependency for the same result) |
| Connectors | One catalog from three sources: a curated list of app makers' own remote MCP servers, the KnightCode plugin catalogs, and Composio for the long tail; OAuth held in the cloud; no source branding shown | Plugins only (they cover mostly developer tools and miss Google Workspace, Microsoft 365, CRM, HR, finance and social apps); an in-house REST-to-MCP gateway (too much to build and maintain now); Composio for everything (per-call cost, lock-in, and every call through a third party even where the app maker runs its own server) |
| Channels | Telegram, Slack and email, through one channel-adapter contract | SMS, iMessage, WhatsApp in the MVP (per-message or per-line costs too high for a $10 plan) |
| Realtime protocol | Chord objects over WebSocket, contracts in `packages/bots-protocol` | Connect RPC with protobuf (a second schema system next to TypeBox); ad hoc JSON events (no shared contract for three clients) |
| Sign-in | GitHub, Google, a one-time email code, or a passkey | GitHub only (non-developers cannot sign up); sharing the remote relay's accounts (the owner wants a separate platform) |
| Desktop integration | A product switcher on the sidebar's product name: KnightCode / KnightCode Bots | A "Bots" section in the coding sidebar (crowds coding threads; no room for group chats, routines and files) |
| One UI | `packages/bots-ui`, used by the web app and the desktop app | Two UIs (they drift) |
| Pricing | $10/month plan with included computer hours and storage; credits at cost x 1.1; top-ups of any amount, minimum $5 | Credits at exactly 1x (payment fees alone would lose money on every top-up); per-CPU-second billing (fairer but confusing) |
| First bot | Every user starts with a normal bot; Chief of Staff is a template | Starting with a Chief of Staff (too much for a first experience) |
| Bot email format | `<bot>.<handle>@bots.knightcode.dev` | User-chosen global names (popular names run out); per-user subdomains (DNS and sender reputation per user) |
| Connector skills | Offered on connect, ticked by default, loaded lazily | Always bundled with no choice (prompt bloat); always separate (users miss the know-how that makes a connector useful) |
| Paying | Stripe's Link wallet for agents with single-use cards; every purchase confirmed with a passkey | Storing users' cards and typing them into checkouts (puts KnightCode in card-data compliance scope) |
| Bank data | Plaid, read-only | Bots signing in to bank websites (fragile, often blocked, and holds bank passwords) |
| Home connection routing | Through the desktop app's connection or a Tailscale exit node | Residential proxy services (paid per GB, and the addresses are not the user's) |
| Pages | Structured blocks rendered by KnightCode's components | Bot-written HTML and scripts in a sandboxed frame (code execution, inconsistent look, harder to keep live) |

## 4. Accounts and connected model providers

Owns: sign-in to KnightCode Bots, the handle, provider connections, the
credential vault.

- Sign-in: GitHub, Google, a one-time email code, or a passkey (section 21).
  The desktop app signs in once through the system browser; the CLI uses the
  same account later.
- Handle: chosen once at sign-up, suggested from the user's name. Lowercase
  letters, digits and hyphens, 3 to 20 characters, unique. It appears in
  every bot's email address.
- "Connect to KnightCode Bots" (desktop app, and later the CLI) lists the
  providers the user is signed in to locally. For each OAuth provider it runs
  that provider's sign-in again (browser authorize, or a device code opened
  with the code pre-filled), so the user clicks once per provider. The new
  tokens go to the cloud. API keys are copied as they are. The local
  credentials are never read for their tokens and never uploaded.
- The cloud sign-in runs in its own login context with an in-memory
  credential sink. It does not use the desktop's existing account login
  handler, which writes the local credential store. The result is uploaded
  against a short-lived enrollment the desktop requested for that account
  and provider, and the sink is then discarded. Tests confirm local
  credentials are unchanged after connecting and after every cloud refresh.
  Each provider's flow (loopback callback in the desktop, or device code) is
  listed with its cancellation behavior; a provider that fails midway leaves
  the others connected.
- Each provider connection lives in the user's vault. Refreshes run inside
  the user's Durable Object behind a per-credential lock (one in-flight
  refresh promise that every caller awaits). The object being single-threaded
  is not enough on its own, because other events run while the token request
  is awaiting the network. A refresh that fails terminally (revoked,
  expired, reused) marks the connection "Reconnect needed" and posts a card in
  the affected bots' chats; transient failures retry.
- Provider rules, checked before launch:
  - Claude sign-in: allowed. Usage from bots bills to the account's
    pay-as-you-go extra usage, not the plan's included limits. The Claude row
    says so in one line.
  - ChatGPT sign-in: apply to OpenAI's official third-party sign-in program;
    enable when approved or confirmed allowed.
  - GitHub Copilot and xAI sign-in: enable only after their terms are
    confirmed.
  - API keys: always allowed.

## 5. Bots and the conversation

Owns: bot records, the thread, runs, steering, templates.

- A bot has a name, a one-line "what I'm for" description (other bots read
  it), instructions with version history, a model and thinking level, a
  color, and settings for approvals, computer and channels.
- One continuous visible thread per bot. Internal runs and retries are not
  shown as separate chats.
- A message sent while a run is going steers that run instead of queueing.
- A pending question or approval card never blocks the chat: the user can
  keep talking, and the card stays answerable.
- The chat shows replies, useful progress, results and genuine requests for
  help, not the internal tool lifecycle. Advanced detail appears on demand.
- Settings from chat: a bot changes its own name, model, thinking level or
  instructions when the user asks, through one settings tool that reads when
  called without fields and patches when given fields. Each change shows Undo
  and is versioned. A bot never widens its own powers from chat: credentials,
  disabled tools, management rights, computer access and approval rules stay
  in the UI. Runs the user did not start keep an approval hold on
  self-changes. Low-risk user preferences (appearance, time zone,
  notifications) can also change from chat; email, sign-in, billing and
  deletion cannot.
- A built-in help skill answers questions about KnightCode Bots from its own
  docs instead of guessing.
- Chat:
  - attachments (files and images; a model that cannot read images still gets
    the file to work with);
  - @mentions of bots, group chats, routines and connected apps; `/` runs a
    skill;
  - react, reply, copy, and quote a selected part of a message;
  - Stop ends the current run;
  - replies render formatted text, tables, charts and diagrams (Mermaid), and
    files open in a preview;
  - question cards with choices, approval cards and takeover requests;
  - link previews;
  - interactive panels from MCP servers that offer them (MCP Apps). The
    desktop bridge's protocol and rendering code is reused through a host
    adapter, but its approval path is not: app actions go through the same
    server-side policy as model actions (section 13). Panels are served from
    a separate sandbox origin with a strict content security policy, never
    from the signed-in origin;
  - an optional "Show tools used" setting, off by default, that lists the
    tools behind a reply.
- Finding things: search across bots and conversations; Cmd+K (Ctrl+K) jumps
  to any bot; an Activity view lists every run with status and date filters;
  unread badges and a "Needs you" marker; pin, sections, mark unread,
  duplicate, archive and restore bots.
- Notifications per bot: when it finishes, when it needs input, or never.
- Knowledge files: the user attaches reference documents to a bot (a brand
  guide, a price list). They live in the user's file store, are listed in the
  bot's context by name, and are read when relevant.
- Onboarding checklist for new users: connect providers, create the first
  bot, connect an app, set approvals, link a chat app. Each item links to its
  screen and disappears when done.
- Lazy tools: the model sees a short core tool list plus `tool_search` over
  the full catalog (connectors, skills, built-ins), so each call carries fewer
  tool definitions and users spend fewer tokens. CI checks a byte budget on
  the visible tool list.
- Image generation: a tool that makes images through the user's own
  connected provider when it offers an image model; hidden otherwise.
- Templates: an intentional configuration (instructions, suggested
  connectors, routines and triggers). A template never carries anyone's
  files, credentials or memory. Every template's text is written for
  KnightCode Bots. The gallery covers these areas:
  - Engineering: PR Reviewer, Issue Triager, Bug Reproduction, Product
    Performance, Coding Agent Orchestrator, Playtest Operator, Prototype
    Builder, Devbot.
  - Design: Figma Assistant, Motion Playground, Design Exploration.
  - Marketing: Social Media Manager, SEO Auditor, Newsletter Writer,
    Competitive Intelligence, Paid Media.
  - Customer support: Ticket Triage, Account Health, Account Manager,
    Enablement Assistant.
  - Product: Feedback Analyst, Feature Request Tracker, Docs Auditor, Beta
    Adoption Watcher, Call FAQ Miner.
  - Operations and finance: Expense Manager, Invoice Coordinator, Contract
    Desk, Security Questionnaire Filler, Vendor Portal Operator.
  - Recruiting and people: Talent Scout, Hiring Screener, Calendar
    Coordinator, Onboarding Manager.
  - Sales: Sales Outbound, Account Research, Meeting Prep, Pipeline Analyst,
    Sales Call Coach.
  - Productivity: Chief of Staff, Daily Briefing, Executive Assistant, Inbox
    Manager, Presentation Designer.
- Import an existing agent: "Copy prompt" gives the user a prompt to send to
  the assistant or bot they are leaving. It asks that assistant to write out
  its name, instructions, routines and their triggers, skills, connected apps,
  and what it remembers about the user, as the recipe JSON below. The user
  pastes the answer (or picks the file it produced). Trigger descriptions,
  which the recipe has no field for, are kept as a note on each paused
  routine. Before anything is created, a preview lists every item found, with
  the full text of the instructions and skills, and a checkbox per item:
  - instructions become the new bot's instructions;
  - memory goes to that bot's notes or to shared memory;
  - skills go to the user's skills;
  - routines arrive paused;
  - connected apps become a checklist of apps to connect.
  Anything that acts on its own (routines, connectors) starts unticked, and
  text that looks like a credential is never imported. The importer never
  calls another product's servers; it reads only what the user pastes.
- Template format: a JSON recipe, at most 25 MB, compatible with the recipe
  format other bot apps already use, so templates move both ways:

  ```ts
  type Recipe = {
    profile: { name: string; description: string; // description = instructions
               avatarColor?: string; avatarShape?: string };
    memory: { kind?: "profile" | "log"; createdAt?: string; content: string }[];
    skills: { name: string; description: string; content: string }[];
    routines: { name: string; slug: string; description: string;
                content: string }[]; // the prompt; no triggers
    plugins: { name: string; description?: string; pluginId: string }[];
    gettingStarted?: { skill: string }; // must name one of `skills`
  };
  ```

  Mapping on import: `profile` becomes the bot; `memory` goes to the new
  bot's notes; `skills` go to the user's skills; `routines` arrive paused with
  no trigger until the user adds one; `plugins` are matched to catalog entries
  by id, then by name, and unmatched ones are listed; `gettingStarted.skill`
  becomes a "Run setup" button on the new bot, shown in the preview as its own
  item and never run automatically. Unknown fields are ignored and kept
  nowhere.
- A recipe someone else made is outside text: its instructions and skills
  could tell a bot to do harm. Its memory entries start unticked and never go
  to shared memory, so another person's facts cannot leak into, or poison,
  what all the user's bots believe. Memory reaches shared memory only from
  the user's own agent through the copy prompt, after the user ticks it.
- Recipes come in as a pasted JSON block, a `.json` file, or the answer to the
  "Copy prompt" above, which asks the old bot to write out this exact JSON.
- Export: any bot can be exported as a recipe and imported again, here or in
  any app that reads the format. This is also how users share setups in the
  MVP.
- New users start with one normal bot.

## 6. Memory

Owns: what bots remember, recall, consolidation, long-thread context.

Per bot:

- Notes: one fact per file, with a short frontmatter (name, one-line
  description, type), plus an index file the bot always sees. The index
  holds one line per note, never the note's content.
- Recall: before each turn, one model call selects up to 5 notes relevant to
  the new message from the notes' names and descriptions. A note is skipped
  only while its current version is in the assembled prompt; one dropped by
  compaction or since corrected becomes eligible again. Candidates come from
  every configured retrieval method (keyword and meaning-based) before the
  call. The call is skipped when every note already fits in the prompt or no
  method finds a candidate, because it costs the user tokens on every turn.
  The memory helper model is the user's choice, so they can pick a cheap one.
- Staleness: notes older than a day are shown with their age ("47 days ago")
  and a reminder to verify before asserting them.
- Extraction: after a run, a background pass saves what the run learned. It
  is skipped when the run already wrote notes itself.
- Consolidation ("dream"): a daily routine, once enough has changed, merges
  duplicates, converts relative dates to absolute ones, deletes contradicted
  notes and keeps the index short.
- Search index: keyword (SQLite FTS5) plus meaning-based search, weighted
  toward recent notes, so recall still works with hundreds of notes. Without
  embeddings it falls back to keyword search only.
- Open work: a short list of things the bot started and has not finished. The
  user can add, complete or remove items.

Across bots:

- Shared memory: facts every bot of the user reads (name, company, writing
  preferences). "Share with all my bots" moves selected facts there; a check
  keeps facts that look private where they were and says how many it kept.
- A written summary of what the user's bots know about them, regenerated only
  when its facts change.
- Import: a copy-paste prompt the user runs in another assistant, whose
  answer the bot turns into notes.

Long threads:

- Threads must work at 10,000 messages. Old messages drop out of the prompt
  but stay reachable through two tools, `search_history` and `read_history`,
  which return bounded excerpts with stable references and check later
  corrections before the bot claims to remember something.
- Context is assembled by rules, not model calls: recent exchanges in full,
  older ones shortened. A summary is written only when nothing cheaper fits,
  and is reused until the messages it covers change. The existing compaction
  in `@knightcode/durable` is the starting point.
- Prompt order keeps the provider cache warm: stable instructions first,
  changing memory and open work last. A cold cache never triggers a paid
  summary.
- Access is checked on every history read. A model-supplied message id is
  not authorization.

Boundaries and verification:

- Memory never crosses users. What a bot creates stays with that bot unless
  shared.
- Users can read, download and delete every note.
- A recall test suite covers facts, reworded facts, dates, decisions changed
  later, and open work, across chats of 100, 1,000 and 10,000 messages.

## 7. The computer

Owns: the per-user container, sleep and resume, screens, takeover, the
provider layer.

- One computer per user, shared by all of that user's bots: same files,
  same installed tools. When several bots work at once, each gets its own X
  display and Chrome process with its own persistent profile. Profiles are
  never merged or cloned between bots.
- Size to start: 2 vCPU, 6 GiB memory, 16 GB disk (Cloudflare's minimum is
  3 GiB per vCPU). Adjust after measuring the beta.
- No cap on bots per user. Simultaneous screens are bounded by the
  computer's memory; a bot that cannot get a screen waits for one, while its
  shell and file tools keep working (builder's call on the exact limit).
- Trust boundary: a user's bots trust each other, since they share one
  owner. Each bot runs its shell and Chrome as its own OS user, so one bot
  cannot read another bot's browser profile or processes; `shared/` is
  group-writable. A bot with computer access can reach the internet
  directly, so per-connector Blocked rules cannot stop it doing the same
  thing through its browser or shell. Computer access is therefore a
  per-bot permission, and its setting says so. Logins and card numbers filled
  into a bot's browser are hidden from the transcript, not from code that
  bot runs.
- The Durable Object reaches the container over a container port through
  `knightcode-env`. `RemoteExecutionEnv` currently takes a concrete
  child-process `Connection`, so a transport abstraction in `packages/env` is
  a prerequisite change in that package. It keeps the framing, cancellation,
  session handles and unknown-outcome semantics. The image builds the Linux
  daemon binary itself.
- Image: Ubuntu, `knightcode-env` daemon, Xvfb, a window manager, Chromium,
  noVNC, git, `gh`, Node, Python with `uv`, and document tools (pdftotext,
  pandoc). Built in CI and pinned by digest.
- Lifecycle: starts lazily when a bot needs graphical or shell tools, or the
  user opens the screen. Sleeps after 10 minutes with no bot run, no user
  control and no open viewer. One idle timer for the whole computer.
- Saves: one save coordinator per computer owns every save, holding an
  exclusive lease with a fencing generation, so a stale job cannot publish.
  It saves only when no bot run or user control holds the computer, and
  before sleep. It quiesces browsers, archives the workspace (home directory,
  including Chrome profiles) sealed with the user's data key (AES-256-GCM in
  64 KiB segments), and uploads it to R2 as an immutable, numbered
  generation. A manifest records the segment count, order and a final
  authentication tag, so a truncated or reordered archive is rejected. A
  container snapshot tagged with the same generation is the fast path.
  Snapshots expire after 30 days without a restore, so R2 is the source of
  truth. Work since the last completed save is lost if the computer dies;
  excluded dependencies (`.venv`, `node_modules`) are rebuilt by the bot or
  the setup script.
- Excluded from saves: caches, `node_modules`, `.venv`, build output, logs,
  and Chrome's transient caches and locks. Login state is kept.
- On wake: restore the snapshot only if its generation matches the newest
  completed save, else the R2 archive of that generation. Chrome
  reopens its last session, so tabs come back on the same pages, still
  signed in.
- Screen: noVNC through a short-lived, revocable capability URL issued by the
  Worker. View and control are separate capabilities. Chrome's debugging port
  binds to the container's loopback only.
- Takeover: the user can take exclusive control of a bot's screen (to sign in
  or solve a CAPTCHA); the bot can ask for it. Releasing control lets the bot
  continue.
- Browser tools for models: page snapshot with element references, act on a
  reference, navigate; desktop screenshot and input tools as a fallback.
  Identical consecutive screenshots are not resent to the model.
- Maintenance actions: Stop (shut down now), Update (save the workspace, then
  rebuild on the current image), Recover (recreate a broken computer from the
  last save), Reset (return to the last saved workspace, discarding unsaved
  changes). Each runs as a durable job that holds off new runs while it works
  and shows progress.
- Setup script: an owner-editable script (for example `apt-get install` of
  extra packages) that runs on every fresh provision and rebuild, because
  system packages outside the home directory are not part of saves.
- Browser hardening: one consistent fingerprint per bot profile (user agent,
  platform, fonts, screen size); time zone and language matched to the exit
  address; WebRTC limited to the proxy so it cannot leak addresses; no DNS
  lookups that bypass the proxy; QUIC off when traffic is proxied. Sites see a
  normal, stable browser, which cuts CAPTCHAs and blocks.
- Home connection routing (optional, off by default): the computer's web
  traffic leaves through the user's own internet connection, so sites see the
  user's home address. Two routes:
  - through the desktop app: an egress proxy in the container (HTTP CONNECT
    and WebSocket) forwards over the desktop app's existing outbound
    connection (section 14);
  - through Tailscale: the computer uses one of the user's exit nodes, with
    Chrome pointed at tailscaled's local proxy (userspace networking, no TUN
    device needed).
  The user chooses fail-closed (traffic stops if the route drops) or falling
  back to the cloud address. Speed is limited by the user's upload bandwidth.
  The home proxy itself allows public destinations only: localhost, the LAN
  and private ranges are refused unless the user authorizes a specific host.
  Turning on home routing never grants private-network access.
- Tailscale: the computer can join the user's tailnet with an ephemeral,
  tagged auth key the user creates, so bots reach private services (a home
  server, a private MCP server). The key lives in the vault, and the node
  leaves the tailnet when the computer stops.
- Provider layer: a `ComputerProvider` interface (provision, reconnect, stop,
  destroy, exec, files, screen, workspace export and import). Cloudflare is
  the only MVP implementation. A second provider (E2B) must need only a new
  implementation and a setting.
- Stdio MCP servers from plugins run inside the user's computer, never in the
  Worker.
- Abuse controls: outbound SMTP (port 25) and known mining pools are blocked
  from computers, outbound connection rates are limited per computer, and a
  computer is suspended on confirmed abuse reports. The card required at
  sign-up (section 16) is the first line of defence.

## 8. Files and storage

Owns: the per-user file store.

- One encrypted store per user in R2, under the user's data key: workspace
  archives, files bots send in chat, attachments users upload.
- Every file a bot sends appears in its chat and in a Files view.
- Deleting the user's data key makes their objects unreadable; a reconciler
  then deletes objects no live record owns.

## 9. Connectors

Owns: connecting apps, the connector token vault, per-bot app choice.

- One catalog, searchable by app and grouped by category (developer tools,
  productivity, Google Workspace, Microsoft 365, CRM and sales, marketing and
  social, SEO, support, HR, finance, data). Each entry shows the app's name,
  icon and maker. Which source supplies an entry is internal: no marketplace,
  vendor-of-the-marketplace or "imported from" labels appear in KnightCode
  Bots. When two sources offer the same app, one entry is shown, preferring
  the sources in the order below.
- Source 1, curated official servers: a list KnightCode maintains of remote
  MCP servers run by the app makers themselves (for example Google's Gmail,
  Calendar, Drive and Chat servers, and the servers Slack, Notion, Linear,
  HubSpot and others host). An entry is data (name, icon, URL, auth method,
  scopes, category), not code. Apps whose OAuth needs a registered client
  (Google, Microsoft, Slack) use KnightCode's registered app for that
  provider. Google requires app verification for sensitive scopes
  (Calendar, Docs, Sheets) before launch, and a yearly security assessment
  for restricted ones (Gmail, full Drive); until that passes, restricted
  Google apps go through Composio and Drive uses per-file access.
- Source 2, KnightCode plugins: the Claude and xAI official marketplaces the
  CLI already supports. Plugins that only add skills appear under Skills, not
  as connectors.
- Source 3, Composio: the long tail, for apps with neither an official server
  nor a plugin (HR, finance, CRM, social and others; about 500 apps by
  third-party count, to be confirmed against Composio's API before launch).
  Also Gmail at launch: Composio's Google app is already verified, so Gmail's
  restricted scopes need no Google security review of our own. Move Gmail to
  Google's own server once KnightCode's Google app passes that review.
  Trade-off, accepted: for Composio-backed apps, tokens are held by Composio
  and calls pass through it; the connect screen says so in one line.
- Composio's per-call cost is platform-level. Normal use is included in the
  plan under a fair-use allowance; beyond it, calls are billed from credits at
  cost x 1.1 (section 16). Composio changed its pricing in August 2026;
  confirm current rates before setting the allowance.
- Any remote MCP server URL can still be added by hand.
- Social posting goes through scheduling-tool connectors (Buffer, Postiz,
  Typefully or similar) or Composio, not through each network's own developer
  program. The bot's browser is the fallback.
- OAuth for MCP servers runs in the cloud with `packages/mcp`'s auth support;
  tokens go to the user's vault and refresh in the user's Durable Object.
- Connections belong to the user, not to a bot. Each bot chooses which
  connected apps it uses; using a new one asks first.
- Connector skills: connecting an app offers that app's skills with one
  checkbox, ticked by default. Skills come from the app's plugin when it has
  one; KnightCode writes skills for the most used apps that have none (Gmail,
  Google Calendar, Drive, HubSpot, Notion, Slack, X, LinkedIn and similar).
  Only each skill's one-line description sits in the prompt until the skill
  is used. Skills can be removed without disconnecting the app.
- Usage note per connector: a short instruction (at most 500 characters) the
  bot always follows when using that app, such as "always draft, never send"
  or which store to change. KnightCode ships notes for apps that need them;
  users edit or replace them.
- Permissions per connector: reads, writes and individual tools are each set
  to Auto review, Needs approval or Blocked, feeding the approval system
  (section 13).
- Plugin parts that would run third-party code in the Worker (hooks, local
  MCP commands, skill scripts) are not executed there. Local MCP commands run
  in the user's computer (section 7).
- Credentials are never shown to the model or returned by the API.
- Every outbound request in the connector path goes through one guarded
  fetch: the configured URL, OAuth metadata discovery, authorization, token
  and registration endpoints, and every redirect. Each hop is checked
  against private and metadata addresses with the checked address pinned,
  TLS verified against the hostname, and credentials forwarded only to the
  origin they were issued for.
- Plugin catalogs are indexed by a scheduled job that fetches marketplace
  manifests and plugin files over HTTPS (no git in the Worker). It keeps the
  CLI's trust and inventory checks and stores the catalog in D1 and R2.

## 10. Channels

Owns: Telegram, Slack and email, and the adapter contract for later ones.

- Contract: link an external identity to a user and bot, receive a message
  into the bot's thread, send a reply, handle attachments, and join group
  conversations with a listening mode. Use Vercel's Chat SDK adapters
  (Slack, Telegram, and later WhatsApp, Teams, Discord) if they run on
  Workers; otherwise implement the same contract directly.
- Telegram: one KnightCode Bots Telegram bot. The user picks a bot in
  Settings, then sends the shown code to the Telegram bot within 10 minutes.
- Slack: one distributed Slack app. "Add to Slack" installs it in a
  workspace; "Link DMs" routes direct messages to a bot. Apply for the Slack
  Marketplace listing, because unlisted apps are limited to about one history
  read per minute.
- Group conversations (Telegram groups, Slack channels): the user approves
  the invite; each conversation is set to "Mentions only" or "Listen", with
  optional plain-language room rules.
- Email: each bot gets `<bot>.<handle>@bots.knightcode.dev`.
  - The bot part comes from the bot's name. If two of a user's bots clash,
    the user picks another; the system never appends numbers.
  - Renaming keeps the old address delivering, and it is never reassigned.
  - Reserved words (admin, support, billing, security, postmaster, abuse,
    noreply and similar) and brand lookalikes are refused.
  - Replies keep `Message-ID`, `In-Reply-To` and `References`, so threads stay
    together in mail clients.
  - SPF, DKIM and DMARC are set on `bots.knightcode.dev` before launch.
  - The domain's reputation is shared by every user, so mail to people who
    have not written to the bot first is capped per user per day (start at
    50 recipients), and a bounce or complaint rate above the provider's
    threshold pauses that user's outbound mail. Replies are not capped.
  - Inbound mail arrives through Email Routing on the subdomain and is
    handled by the Worker; outbound goes through Email Service.
- The web app and desktop app are channels too, and the primary ones.

## 11. Bots working together

Owns: bot-to-bot messages, group chats, helpers, the Chief of Staff tools.

Direct messages:

- Tool `message_bot(to, text, intent)` with intent request, question, status
  or result. Delivery is asynchronous: the target wakes, the sender keeps
  working, and the reply wakes the sender later.
- When a bot finishes a request from another bot, the result goes back
  automatically unless it already sent one.
- Each message carries an id; a retried delivery is recognised and dropped.
- The user's chat shows "Messaged <bot>" or "Message from <bot>"; opening it
  shows the exchange, read-only.
- Bots reach only the same user's bots. They choose whom to ask from each
  bot's "what I'm for" line.
- A chain of bot messages stops after 6 hops; the bot then reports to the
  user. A message from a person starts a new chain. Messages are capped at
  8,000 characters.

Group chats:

- A group holds 2 to 10 bots and the user. Each bot keeps its own memory and
  computer; only the conversation is shared.
- @Name wakes that bot, @everyone wakes all. With no mention, the lead bot
  answers and can bring others in.
- Turns: the group asks each relevant bot for a turn, giving it only the
  messages since its last turn, the list of other members, and a deadline. A
  bot may reply or pass. When the group's turn budget is spent, bots are told
  to wrap up. A result for a cancelled or superseded turn is rejected by its
  turn id.

Helpers:

- A bot can start short-lived helpers for parallel work. Each shows as a card
  (Running, Completed, Failed). Helpers have no memory or chat of their own and
  get no bot-management tools.

Chief of Staff (a template using the management tools):

- Tools: list the user's bots and groups; create a bot; create and edit
  groups; organize the sidebar; edit a managed bot's profile; replace a
  managed bot's instructions (passing the version it read); set a managed
  bot's model; schedule a routine for a managed bot.
- A bot manages only bots it created or that the user assigned to it.
- Replacing instructions or changing a model always shows an approval card
  with the full change, even in the most permissive approval mode. Changes are
  versioned as "Updated by <bot>".
- Management tools exist only in runs the user started. Runs started by an
  email, a webhook, a channel message, a routine or another bot do not get
  them. A run that receives outside text mid-way loses them for the rest of
  that run.
- It cannot delete bots, read or change credentials, or touch bots outside
  its management.
- Its daily briefing is a routine: what every bot did, what waits on the
  user, what is still open.

## 12. Routines and triggers

Owns: routines, every trigger source, the GitHub App.

- A routine is a prompt on a bot plus one or more triggers; any of them fires
  it. One trigger contract (source, filter, event payload as outside text)
  serves every source, so adding a source later is a new adapter, not a new
  mechanism.
- MVP trigger sources:
  - Schedule: a cron expression with a time zone, run by Durable Object
    alarms. A missed run still happens after an outage and the bot is told it
    is late. Only one pending catch-up run exists per routine.
  - GitHub, through a "KnightCode Bots" GitHub App installed on repositories.
    Events: PR opened, pushed, merged, closed; review requested, approved,
    changes requested, commented; PR comment; inline review comment; review
    thread resolved or unresolved; issue opened; issue assigned; CI passed or
    failed (with a branch filter). Optional filter: only events by listed
    GitHub users. The bot's comments appear as the app, not as the user.
  - Slack, through the same Slack app as the channel (section 10), in a
    chosen channel or any channel it is in: a mention, a message containing a
    keyword, an emoji reaction (optionally only the user's own), or any
    message.
  - The bot's email address: mail received, optionally filtered by sender. By
    default only mail that passes SPF or DKIM fires a routine.
  - Gmail and other connected apps that offer events through Composio (for
    example "new email" in the user's own Gmail).
  - Webhook: each routine can mint a URL with a secret. Linear, Sentry,
    PagerDuty, Stripe and any other service with outgoing webhooks can fire a
    routine this way from day one.
  - Watch for changes: check a connected app's read tool, a file or folder,
    or a command's output, and run only when the result changed; optionally
    post "No changes" each time. Connector checks run in the Durable Object
    without waking the computer, every 5 minutes to every day. File and
    command checks need the computer: they run when it is already awake, and
    otherwise at most once an hour, and the routine editor shows the computer
    hours they will use. Otherwise a 5-minute check would keep the computer
    awake around the clock.
- One-off reminders ("remind me in 20 minutes") are routines with one run.
- Routines are created from chat ("every weekday at 8am, summarize my
  inbox") or in the bot's Routines list. Each has Test run, Active on or off,
  Run history with results, Stop while running, and optionally its own model
  and thinking level.
- Trigger payloads are outside text (section 13).

## 13. Approvals and safety

Owns: approval modes, allow and block lists, outside-text rules.

- Three modes per user, overridable per bot:
  - Never ask: runs every action in runs the user started, and every action
    within a routine's standing grant (section 24). It never lets outside
    text create or widen a grant.
  - Auto: a reviewer model, chosen by the user, passes actions that fit what
    the owner asked for and asks when an action is off-task or irreversible.
    If the reviewer errors or is unsure, it asks.
  - Ask: asks before any action that changes something.
- Allow and Block lists of exact tools or sites grow from approval cards and
  settings. A blocked action is refused without a card in every mode.
- Outside text (email, webhooks, channel messages from others, web pages,
  other bots) can steer a run. A run it started or touched may act only
  within the standing grant of the routine that owns it; anything else asks,
  in every mode (section 24).
- Outward actions follow the action-record rules in section 24.
- Secrets are redacted from logs, excerpts and history search.

## 14. The user's own computer

Owns: letting bots use the PC the desktop app runs on.

- Off by default. "Let bots use this computer" in the desktop app's Settings,
  confirmed in a native dialog, revocable locally at any time.
- The desktop app keeps an outbound WebSocket to the cloud; no inbound ports.
  Commands and file operations go through `knightcode-env` over that
  connection, as a new `packages/env` connection type.
- In every approval mode, a bot asks before its first command in a session
  and before it first uses each app; "Allow on this computer" covers the rest
  until removed. Block rules always refuse.
- Every command and file write is recorded in the bot's activity.
- Works only while the desktop app is running and the PC is awake; otherwise
  the bot is told the computer is offline.
- Windows has no filesystem sandbox here. The setting says plainly that bots
  act with the user's full access.

## 15. Clients

Owns: the web app, the desktop integration, the protocol package.

- `packages/bots-protocol`: TypeBox contracts for every client call and
  realtime object. The web app, the desktop app and, later, the CLI are
  clients of the same contracts.
- `packages/bots-ui`: React components for bots, chat, group chats,
  routines, files, computer screen, connectors, settings and billing. React
  19 and Vite, matching the desktop renderer.
- Web app at `bots.knightcode.dev`, served as Worker static assets.
  Phone-friendly layouts, installable to the home screen, Web Push for
  approvals, questions and replies.
- Desktop app: the sidebar's product name becomes a switcher, "KnightCode" /
  "KnightCode Bots". Bots mode renders `packages/bots-ui`. A badge on the
  switcher shows when a bot needs the user. The desktop app also hosts
  "Connect to KnightCode Bots" (section 4) and the computer link (section 14).
- Authentication:
  - Web: an HttpOnly, Secure, SameSite session cookie, with Origin checks on
    every state-changing request and on WebSocket upgrades.
  - Desktop: the main process holds the long-lived session (in the OS
    keychain through Electron's safe storage) and gives the renderer
    short-lived, scoped connection tickets over IPC. The renderer talks to
    `bots.knightcode.dev` directly with a ticket. Nothing goes through the
    local app server, so the coding harness is untouched.
  - A WebSocket authenticates with a ticket in its first frame. The server
    builds a principal (account, workspace, client) and checks it against
    every object, action and file reference; contracts and keys are not
    authorization. Revoking a session closes its live connections.
- Users can export their chats, notes, files, pages and bot recipes, and
  delete their account. Deletion follows an inventory of every data class:
  D1 rows; every bot's and the user's Durable Object storage, including
  transcripts and search indexes; R2 objects and container snapshots;
  pending jobs, which are cancelled; Composio, Plaid, Stripe and 1Password
  connections, which are revoked; and analytics records. A deletion
  tombstone stops recovery jobs from recreating the account. Destroying the
  data key makes R2 objects unreadable at once; the other classes are
  deleted, not merely made unreadable.
- Visual design: the UI is measured screen by screen from a reference app,
  and the measurements are kept outside the repository. It is built with
  KnightCode's own components, its own avatar renderer (`bot-avatars` plus
  KnightCode-drawn outlines for 25 named shapes) and open fonts; no file is
  copied from another product. The UI is built first, against an in-memory
  fake that implements `packages/bots-protocol`; the backend follows.
- Data is keyed by account and workspace, with one workspace per account in
  the MVP, so teams can be added later without moving data.
- Notifications: Web Push to the phone is held while the user is active in
  the desktop or web app, and sent once they are away. The desktop app badges
  its dock icon with unread chats.

## 16. Billing

Owns: plans, metering, credits, limits.

- Plan: $10/month. Includes computer hours (start at 60; fixed after the beta
  measures real cost) and 10 GB of storage. Chat and connectors are not
  metered, except Composio-backed calls beyond the plan's allowance.
- A computer hour is awake time, billed in 5-minute increments, including
  starting, saving and restoring. Its rate is a fully loaded cost: container
  time, snapshot and R2 storage and operations, egress, and Durable Object
  time, from a dated cost table the beta fills in.
- Reservations: the user's Durable Object holds the authoritative balance.
  Billable work reserves before it starts (the next 5-minute block of
  computer time, a Composio call, a month's bank-link fee at link time) and
  settles idempotently, releasing what it did not use. The spending limit
  therefore holds within one increment.
- Credits from a top-up are the amount paid minus the actual payment fee,
  converted at cost x 1.1. The 1.1 leaves 9.09% of revenue for measurement
  error and overhead. Deducting the fee itself is what keeps a $5 top-up
  from losing money; the fee is shown on the receipt.
- Resource limits per account: concurrent runs, helper fan-out per run,
  trigger rate per routine, and stored data, each with a default the beta
  tunes.
- Free trial: 3 days of the full plan for new users. A card is required at
  sign-up, because a free computer with internet access invites mining and
  spam. The trial includes a capped amount of computer time (start at 6
  hours), sends a reminder a day before it ends, and becomes the paid plan
  unless cancelled. A cancelled or failed payment stops routines and the
  computer; the user can still sign in, read their bots' history, export, and
  subscribe again. Implemented as a Stripe subscription trial.
- Credits: computer hours at measured average cost x 1.1; extra storage at
  cost x 1.1; paid third-party services passed through at cost x 1.1. The
  hourly rate is reviewed every few months.
- Top-ups: $5, $15, $25 or any amount the user enters; minimum $5. Optional
  automatic top-up, off by default.
- Spending limit set by the user. At the limit every metered extra stops:
  the computer, Composio calls above the allowance, and new bank links. Bots
  keep chatting and using unmetered connectors.
- Bank links (section 22) cost a monthly fee for as long as they exist. If a
  month's fee cannot be paid from credits, the user is told, and the link is
  removed after seven days so the fee stops; relinking restores it. Bank
  links and other pass-through services are not available during the trial.
- Usage page: runs, tokens and model cost per bot, per routine and per model,
  from provider usage reports, even though the user pays the provider. Where a
  provider reports subscription limits, the page shows them.
- Stripe for payments. An append-only billing journal in D1; balances are
  projections of it. Webhook replays never add credit twice; refunds reduce
  the balance.

## 17. Durability and operations

Owns: retries, recovery, observability, deployment.

- Bot runs commit progress after every step (`@knightcode/durable`); a crash
  or deploy resumes from the last step.
- Model and connector failures retry with backoff, then report in chat.
- Outward deliveries go through Queues with a dead-letter queue.
- Multi-step background jobs (computer save and restore, memory
  consolidation, billing settlement) are Workflows with per-step retries.
- Observability: Workers logs and PostHog (existing project) for product
  events and errors. No message content in telemetry.
- Verification runs offline: Vercel Labs' `emulate` provides local, stateful
  GitHub, Google, Slack, Stripe, Microsoft, Resend, Linear and Twilio
  services. Custom emulators built with it cover Telegram, Composio and
  Plaid. A fake model server stands in for providers, so no test spends a
  user's tokens. Cloudflare bindings run locally through the Workers test
  pool and `wrangler dev`.
- Layout:
  - `apps/bots`: the Worker (API, Durable Objects, email and queue handlers,
    static assets), its `wrangler.jsonc`, and `computer/` for the image.
  - `packages/bots-protocol`, `packages/bots-ui`.
  - `.github/workflows/deploy-bots.yml`: deploys from `main`.
- Domain: `bots.knightcode.dev` as a Workers custom domain in the existing
  `knightcode.dev` zone; Email Routing enabled on the subdomain.

## 18. Skills

Owns: the skills library, saving skills, teaching by demonstration.

- A skill is written know-how for one kind of task: a name, a one-line "when
  to use it", and the steps. Bots pick a matching skill on their own; `/`
  runs one explicitly.
- Library (account menu, Skills): Your skills (written by the user or saved
  by bots), From apps (added with connectors, section 9), and Browse (skills
  from the plugin catalogs). New skill writes one by hand; From GitHub
  previews and adds skills from a repository.
- Skills the user adds are available to all their bots. A skill a bot saves
  is available to that bot until the user shares it with all bots.
- "Save that as a skill": after a multi-step task, the bot writes a skill
  from what it just did and shows it as a draft card to edit and save.
- Teach a task by showing it:
  - In the computer view, Teach a task asks what result the user will
    demonstrate ("export this week's list from the CRM to the shared
    folder"), then Start recording.
  - The user does the task on the bot's screen. The bot watches and does not
    act. Each step is recorded as the input event, a screenshot and the
    page's element snapshot.
  - Passwords are typed through Protected input, which is never recorded.
  - Stop teaching sends the recording to the bot's model, which drafts a
    skill: the steps, when to use it, what to check, and when to ask first.
    The draft card offers Edit, Save, Test (run it once) and Add to routine.
  - The recording is deleted once the skill is saved or discarded.
  - Available in the web and desktop apps.
- Skill scripts from plugins never run in the Worker (section 9).

## 19. Pages

Owns: documents and live dashboards bots build, and the library.

- A page is a document a bot creates and keeps current: a report, a tracker,
  a dashboard. It is made of blocks: rich text, tables, charts, images,
  embedded files and live widgets.
- A live widget reads from a source the bot defines (a routine's latest
  output, a connector read tool, a file) and refreshes on a schedule or when
  its routine runs. A refresh reads data directly and never calls a model,
  so it costs the user no tokens.
- A button on a page runs a routine or a connector action. A press is a
  user-started run and follows the approval rules.
- A page is stored as structured blocks (JSON), never as bot-written HTML or
  script. The UI renders blocks with its own components, so a page cannot run
  code. Charts use a declarative spec rendered by the client.
- Library: every page, searchable, with pins, owner bot and last update. A
  bot edits pages it created; the user edits any page. Pages keep version
  history.
- Bots link pages in chat and in briefings. Pages export as Markdown or PDF.

## 20. Inbox, suggestions and catch-up

Owns: the cross-bot inbox, proactive suggestions, the catch-up summary.

- Inbox: one list across all bots of everything waiting on the user
  (approvals, questions, takeover requests, results marked for review, failed
  runs) plus tasks. Each item links to its place in the chat and can be
  pinned, marked done or marked read. Answering a card in chat clears its
  inbox item.
- Tasks: work items a bot or the user creates (title, owner bot, status, due
  date). Each bot's open work (section 6) appears here too.
- Suggestions: a bot may propose work it noticed ("three invoices are
  overdue; want me to chase them?") as a card in its chat and the inbox.
  Accepting starts a user-started run; dismissing teaches the bot to suggest
  less of that kind. Off per bot until the user turns it on, at most a few a
  day per bot, and never acting on its own.
- Catch-up: when the user returns after at least 4 hours with no activity in
  any app, the first screen shows "While you were away": what finished, what
  is waiting and what failed, across all bots, each linking to its place. It
  is written by the user's chosen helper model, and only when something
  happened.

## 21. Vault, 1Password and passkeys

Owns: reusable credentials, 1Password, passkeys.

- Vault: per user, envelope-encrypted (section 4). Values are never shown,
  returned by the API or given to the model. Three kinds:
  - API credentials for an HTTPS origin, injected by the backend into the
    requests a bot makes to that origin (Bearer, a named header, or Basic).
    The bot calls `call_with_secret` with the credential's name and the URL;
    responses are scrubbed of the value in plain and common encoded forms.
  - Website logins for a sign-in page's origin, filled into the page by the
    browser tool without the model seeing them.
  - Command variables, exported to the bot's own shell as environment
    variables. The setting says plainly that the bot's commands can read
    these.
- A bot asks for a credential with `request_secret` (name, origin, kind); the
  user enters it in a protected card that shows the origin before saving.
  `forget_secret` removes one.
- 1Password: the user connects 1Password. When a bot needs a login, the user
  approves on their own device and 1Password fills it, so neither the bot nor
  KnightCode stores the password. Use 1Password's agent sign-in integration
  (announced October 2026) for accounts that support it, and a service
  account scoped to one vault for business accounts. Confirm the integration
  route with 1Password before building.
- Passkeys:
  - Sign in to KnightCode Bots with a passkey, besides GitHub, Google or an
    email code.
  - Spending approvals are confirmed with a passkey (section 22).
  - In the bot's browser: when a site asks for a passkey, the request goes
    through the desktop app to the user's device (Windows Hello, Touch ID)
    and the signed answer comes back. Windows first; macOS needs Apple's
    browser passkey entitlement. Without the desktop app running, the bot asks
    the user to take over instead.

## 22. Payments and bank data

Owns: letting bots pay, spending approvals, bank data.

- KnightCode never stores card numbers. Filling a single-use card into a
  page still means handling card data briefly, so the card-data compliance
  scope of this exact integration must be determined with Stripe before
  launch. Shared payment tokens, which never expose a card number, are
  preferred wherever the merchant accepts them. Filled card fields are
  masked in screenshots, teaching recordings, logs and telemetry.
- Bots pay through Stripe's Link wallet for agents. The user links their
  Link wallet once; for each purchase the bot requests a single-use card, or
  a shared payment token where the merchant accepts one, for a stated
  merchant and amount.
- The single-use card's number is filled into the checkout page by the
  browser tool, the same way saved logins are (section 21), and never shown
  to the model. The card is limited to the approved merchant and amount.
- Every purchase needs a spending approval: a card showing merchant, amount
  and what is being bought, confirmed with the user's passkey. Per-bot limits
  (per purchase and per month) refuse anything above them without a card.
  Completed purchases are recorded in the inbox and the bot's activity.
- Stripe's agent payments are in preview and US-focused. Payments are enabled
  per country as Stripe opens them, and hidden elsewhere.
- Bank data through Plaid: a read-only Finance connector lists the user's
  linked bank, card, loan and brokerage accounts with balances and
  transactions. Bots use it before opening a bank's website. Plaid needs
  production approval and charges a monthly fee per linked account, passed
  through from credits at cost x 1.1. It covers the US, Canada, the UK and
  the EU, and is hidden elsewhere.

## 23. Launch dependencies

Outside approvals and documents the MVP cannot launch without. Each needs
lead time, so start them alongside the build:

- Google OAuth app verification for sensitive scopes (section 9).
- Slack Marketplace listing (section 10).
- OpenAI's third-party ChatGPT sign-in program (section 4).
- Stripe agent payments access, per country (section 22).
- Plaid production approval (section 22).
- 1Password's integration route for third-party agent platforms
  (section 21).
- A GitHub App registered for KnightCode Bots (section 12).
- Composio account and current pricing (section 9).
- A privacy policy and terms of service naming every service that processes
  user data (Cloudflare, Stripe, Composio, Plaid, 1Password, PostHog and the
  user's chosen model providers).
- A legal check before advertising compatibility with another product's
  templates (section 5).
- A card-data compliance determination for agent payments, with Stripe
  (section 22).

## 24. Actions, approvals and recovery

Owns: standing grants, input provenance, action records, durable approvals,
the alarm scheduler.

- Standing grants: a routine carries an explicit grant, set by the owner
  when it is created or edited: which actions, on which targets, with which
  limits (for example "comment on pull requests in owner/repo, at most 20 a
  day"). A run started by outside text may act only within its routine's
  grant. Outside text never creates or widens a grant, in any mode.
- Provenance: every run records whether outside text started or entered it.
  The mark survives steering, helpers, bot messages, retries and new runs
  that continue the work. Notes a marked run writes are labelled, and cannot
  reach shared memory without the user's approval.
- Action records: every outward write (email, post, comment, payment,
  connector write) is first committed as a record: a stable action id, the
  intent, the approval that covers it, and a delivery state (pending, sent,
  confirmed, unknown). Publication to the delivery queue is recoverable from
  the record. Each write adapter is classified as:
  - idempotent: the destination honours the action id, so a retry is safe;
  - reconcilable: the adapter can check whether the action happened (a
    marker in the comment, a Message-ID), so it checks before any retry;
  - neither: an unknown outcome is never retried; the bot reports it and
    asks.
  Browser, shell and plugin writes are "neither" unless proven otherwise.
  The guarantee is: no retry repeats an action whose outcome is unknown.
- Approvals: a pending approval is stored with an immutable digest of the
  exact action, the owner, target, limits, policy version and an expiry. It
  is consumed atomically once, right before dispatch. A changed action, an
  expired approval, or a revoked permission invalidates it. A spending
  approval's passkey challenge is bound to its digest. A waiting card does
  not hold the conversation: the bot keeps working on other things, and the
  approved action runs as its own task when answered.
- Alarm scheduler: each bot's Durable Object keeps one alarm, set to the
  earliest of the harness wake time, a recovery heartbeat while work is
  active, and the next routine deadline. It is armed before any call that can
  start work, as `@knightcode/durable` requires, because the harness reports
  wake changes only after a commit. A harness that fails to open is reopened
  on the next alarm. Overdue firings of one routine are coalesced into one
  catch-up run. Streamed partial output may lose up to the harness's
  persistence window (default 1 second) in a crash; committed steps are never
  lost.
- Tests evict the object with no client connected, during a retry backoff,
  and between admitting work and the wake report, and the work resumes in
  each case.

## Exclusions (recorded for after the MVP)

Do not add in the MVP; these are the planned follow-ups:

- SMS, iMessage, WhatsApp, Teams, Discord, phone calls, voice, meeting bots.
- Teams, shared bots, a public template marketplace.
- Multiple workspaces per account.
- Mac Messages and Mail on the user's computer.
- Referrals (a free month for each invited friend who starts a trial).
- Native iOS or Android apps.
- Memory snapshots or a second computer provider.
- External memory services (vector databases, hosted memory APIs).
- The CLI client (its contracts exist; the client comes after the MVP).
- A group chat per pull request, and shared documents inside group chats.
- Native trigger apps for Linear, Sentry, PagerDuty, Microsoft Teams,
  GitLab, Bitbucket and Azure DevOps (webhook triggers cover them until then).
- Template share links and a public template gallery for user-made
  templates (export and import of template files covers sharing).
- Calling another bot product's servers to import its templates or bots.
- Any path through the remote relay or its accounts.
- Execution of plugin hooks or scripts in the Worker.
- Hardcoded model ids anywhere.

## Left to the builder

- Durable Object boundaries beyond "one per bot": whether the vault, the
  computer coordinator and billing share a per-user object or split.
- D1 schema, R2 key layout, and the encryption library, within section 2's
  rules.
- The exact search scoring and embedding source for memory, within
  section 6.
- Window manager, VNC tuning, and image contents beyond section 7's list.
- Sidebar sections inside Bots mode, and the web app's information
  architecture, within section 15.
- Whether Vercel's Chat SDK runs on Workers (section 10); the contract is
  fixed either way.
- The page block schema and chart spec, within section 19.
- Fingerprint values and proxy settings, within section 7.
- Which apps get KnightCode-written connector skills first, within
  section 9.

## Stop condition

The MVP is complete when:

- A KnightCode desktop user signs up, connects their providers with "Connect
  to KnightCode Bots", and the CLI on the same machine stays signed in.
- They create a PR-review bot, install the GitHub App, and a new PR receives
  a review comment from the app without the user doing anything.
- A bot uses the computer's browser, the computer sleeps after idling, and on
  the next run the same tabs are open and still signed in.
- A bot replies to an email sent to its address, in the same mail thread.
- A Slack message containing a routine's keyword, and a webhook call, each
  fire that routine.
- A user connects Gmail, HubSpot and Notion from one catalog in which no entry
  names a marketplace or where it came from.
- An agent imported with the copy prompt arrives with its instructions and
  notes, and its routines paused.
- The user talks to a bot from Telegram and from Slack, and sees the same
  thread in the web app on a phone.
- Two bots exchange messages and a group chat with three bots completes a task
  without bots talking over each other, and a 7-hop chain is stopped.
- A Chief of Staff bot creates a bot and edits its instructions only after an
  approval card; an email asking it to edit a bot is refused.
- A bot recalls a fact from a note written weeks earlier, and finds an
  exchange from early in a 10,000-message thread.
- Killing the Worker mid-run resumes the run, and no email or comment is sent
  twice.
- A user hits their spending limit: the computer stops, chat keeps working.
- A user teaches a task by recording it, saves the drafted skill, and a
  routine runs it.
- A bot builds a page whose chart refreshes when its routine runs, and a
  button on the page runs a connector action after approval.
- After four hours away, the user sees what finished and what waits; the
  inbox lists every pending approval across bots.
- A bot signs in to a site with a saved login and calls an API with a vault
  key, and neither value appears in the transcript or logs.
- A US user approves a purchase with a passkey and the bot pays with a
  single-use card.
- With home routing on, a site the bot opens sees the user's home address.
- A user enables "Let bots use this computer", and a bot runs a command on
  their PC after one approval.
