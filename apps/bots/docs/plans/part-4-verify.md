# Part 4: Integration and verification

Spec sections: 15, 17, 23, Stop condition.

### Task 4.1: Switch the UI from fake to real

**Files:**
- Modify: `apps/bots/web/src/client.ts`, `apps/desktop/src/renderer/bots/mount.tsx`,
  `apps/bots/web/playwright.config.ts` (`BOTS_BACKEND=real` uses the global
  setup below instead of the Vite fake server; the default stays fake)
- Create: `apps/bots/web/e2e/global-setup.ts` (starts `wrangler dev` on a
  free port with local D1, R2, queues and Durable Objects, the emulators,
  and `apps/bots/test/fake-model-server.ts`, an OpenAI-compatible HTTP
  server with scripted replies, registered by the test account as an
  OpenAI-compatible provider)
- Test: `apps/bots/web/e2e/real-backend.e2e.ts`

**Interfaces:**
- Consumes: every route and frame from Parts 2 and 3; desktop tickets from
  Task 3.9.
- Produces: the web app using `createApiClient(fetch, location.origin)` and
  a ticketed WebSocket unless `VITE_FAKE=1`; the desktop mount using tickets
  from the main process.

- [x] **Step 1: Write the failing test**: sign in through the GitHub
  emulator, add the fake model server as an OpenAI-compatible provider,
  create a bot, send a message, see the streamed reply, reload the page and
  see the same thread.
- [x] **Step 2: Run it to verify it fails** (`bunx playwright test --project ui real-backend`)
- [x] **Step 3: Switch both clients and add the global setup**
- [x] **Step 4: Run the whole `ui` project against the real backend**

Run: `BOTS_BACKEND=real bunx playwright test --project ui`
Expected: every Part 1 behaviour test passes against the real backend.

- [x] **Step 5: Commit**

```bash
git add apps/bots/web/src/client.ts apps/bots/web/playwright.config.ts apps/bots/web/e2e/global-setup.ts apps/bots/web/e2e/real-backend.e2e.ts apps/bots/test/fake-model-server.ts apps/desktop/src/renderer/bots/mount.tsx
git commit -m "feat(bots): connect the UI to the real backend"
```

### Task 4.2: The stop-condition suite

**Files:**
- Create: `apps/bots/web/e2e/stop-conditions.e2e.ts`
- Test: the same file

**Interfaces:**
- Consumes: Task 4.1's global setup.
- Produces: one test per item of the spec's Stop condition, named after it,
  run against `wrangler dev`, the emulators and the fake model. Items that
  need hardware or a platform the runner lacks (the user's own computer on
  macOS, Docker for the computer image) use the fake provider or the Windows
  path and say so in the test name.

- [x] **Step 1: Write the tests**, one per Stop condition item, each
  asserting the observable outcome the spec states (for example: the
  desktop's local credential store is byte-identical after "Connect to
  KnightCode Bots"; a PR opened in the GitHub emulator receives a comment
  from the app; after sleep and wake the same tabs are open and signed in;
  an emailed bot replies in the same thread; a Slack keyword and a webhook
  each fire a routine; the catalog shows no source label; an imported agent
  arrives with paused routines; Telegram and Slack reach the same thread
  the phone layout shows; a 7th hop is stopped; a Chief of Staff edit needs
  approval and an emailed request to edit is refused; a weeks-old note is
  recalled and a 10,000-message history search finds an early exchange;
  killing `wrangler dev` mid-run resumes the run and sends no email twice;
  the spending limit stops the computer and not chat; a taught task becomes
  a skill a routine runs; a page chart refreshes and its button needs
  approval; the catch-up and inbox show pending approvals; vault values
  never appear; a test-mode purchase needs a passkey and uses a single-use
  card; home routing exits through the desktop proxy; a command on the
  user's computer runs after one approval).
- [x] **Step 2: Run them**

Run: `bunx playwright test --project ui stop-conditions`
Expected: every test passes. Fix the owning task's code for any failure
and rerun.

- [x] **Step 3: Commit**

```bash
git add apps/bots/web/e2e/stop-conditions.e2e.ts
git commit -m "test(bots): add the MVP stop-condition suite"
```

### Task 4.3: Deploy configuration (no deploy)

**Files:**
- Modify: `apps/bots/wrangler.jsonc` (an `env.production` block with the
  `bots.knightcode.dev` custom domain, production bindings and Email
  Routing; the top level stays development-only)
- Create: `.github/workflows/deploy-bots.yml`, `apps/bots/DEPLOYING.md`,
  `apps/bots/docs/help/*.md`

**Interfaces:**
- Produces: a workflow that runs only on `workflow_dispatch` (applies D1
  migrations, builds the web app and the computer image, deploys) with
  pinned action SHAs as in `deploy-remote.yml`; `DEPLOYING.md` listing every
  binding, secret, DNS record, Email Routing rule and SPF, DKIM and DMARC
  record the human tasks need; help pages for the help skill.

- [ ] **Step 1: Validate the configuration without deploying**

Run: `bunx wrangler deploy --dry-run --env production --outdir .wrangler/dry` in `apps/bots`
Expected: exit 0, and the bundle in `.wrangler/dry` is under 10 MB
compressed.

- [ ] **Step 2: Lint the workflow**

Run: `bunx actionlint .github/workflows/deploy-bots.yml` (or the repo's
existing workflow check)
Expected: no findings; the only trigger is `workflow_dispatch`.

- [ ] **Step 3: Commit**

```bash
git add apps/bots/wrangler.jsonc .github/workflows/deploy-bots.yml apps/bots/DEPLOYING.md apps/bots/docs/help
git commit -m "chore(bots): add production configuration and a manual deploy workflow"
```

### Task 4.4: Development credentials for live smoke tests

**Files:**
- Modify: `apps/bots/.dev.vars` (gitignored, never committed),
  `apps/bots/docs/plans/mvp-goal-plan.md` ("Human tasks")

Follow "Credentials" in `mvp-goal-plan.md`. Tick each step when the
credential is in `.dev.vars`, or when the step that needs a human is
recorded under "Human tasks" with exactly what is needed.

- [ ] **Step 1: GitHub App and OAuth app (development)**
- [ ] **Step 2: Slack app in a development workspace**
- [ ] **Step 3: Telegram bot**
- [ ] **Step 4: Google Cloud OAuth client in Testing mode**
- [ ] **Step 5: Stripe test-mode keys and a test webhook secret**
- [ ] **Step 6: Composio API key and Plaid sandbox keys**
- [ ] **Step 7: Local Cloudflare resources** (`wrangler d1 create` and the
  rest only for a development account; nothing production)
- [ ] **Step 8: Confirm nothing secret is tracked**

Run: `git status --porcelain` and `git grep -n -I -E "(sk_test|xoxb-|ghp_|AIza)"` in the worktree
Expected: `.dev.vars` is not listed; the grep finds nothing.

- [ ] **Step 9: Commit the plan update** (only if "Human tasks" changed)

```bash
git add apps/bots/docs/plans/mvp-goal-plan.md
git commit -m "docs(bots): record the remaining human tasks"
```

### Task 4.5: The `verify` command

**Files:**
- Create: `apps/bots/scripts/verify.ts`
- Modify: `apps/bots/package.json` (`"verify": "bun scripts/verify.ts"`)

**Interfaces:**
- Produces: `bun run verify` running, in order, and counting failures:
  1. `bun run check-types` at the repo root, then the `typecheck` scripts
     of `apps/bots`, `apps/bots/web`, `packages/bots-ui` and the
     `check-types` script of `apps/desktop` (the root `tsc` does not cover
     apps or `packages/bots-ui`);
  2. `bunx vitest --run` in `packages/bots-protocol`, `packages/bots-ui`,
     `packages/env`, `apps/bots`, and `apps/desktop`;
  3. `bunx playwright test --project ui` in `apps/bots/web` against the
     real backend, including the stop-condition suite;
  4. `bunx playwright test --project reference` when the reference folder
     exists;
  5. `bun scripts/tool-budget.ts`;
  6. the dry-run bundle size check from Task 4.3;
  7. a scan of every tracked file changed on `feat/bots-mvp` for the
     patterns in the reference folder's `banned.txt`, case-insensitive;
  8. a check that every prose line in `apps/bots/docs/design.md` and
     `apps/bots/docs/help/*.md` outside tables and code blocks is at most 80
     characters (the plans carry long signatures and commands, so they are
     exempt);
  9. a check for hardcoded model choices: load every model id from
     `builtinModels().getAllModels()` and fail if any appears as a quoted
     string in `apps/bots`, `packages/bots-protocol` or `packages/bots-ui`
     (test fixtures use ids that are not in the catalog, such as
     `fake-model`).
  It prints each result, then `MVP VERIFIED` and exits 0 only when the
  failure count is 0; otherwise it prints `MVP NOT VERIFIED: <n> failures`
  and exits 1.

- [ ] **Step 1: Write `verify.ts`**
- [ ] **Step 2: Run it**

Run: `bun run verify` in `apps/bots`
Expected: the last line is `MVP VERIFIED`. On any failure, fix the cause in
the owning task's code (rerunning that task's tests), commit, and run
`verify` again until it passes.

- [ ] **Step 3: Commit**

```bash
git add apps/bots/scripts/verify.ts apps/bots/package.json
git commit -m "chore(bots): add the MVP verify command"
```

- [ ] **Step 4: Final run for the goal**

Run `bun run verify` once more in this session and leave its full output
in the transcript. Expected: `MVP VERIFIED` with 0 failures.
