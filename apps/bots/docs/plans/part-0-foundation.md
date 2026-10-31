# Part 0: Foundation and contracts

Spec sections: 2, 3, 15, 17. Run rules: `mvp-goal-plan.md`.

### Task 0.1: Worktree and docs

**Files:**
- Create (in the worktree): `apps/bots/docs/design.md`,
  `apps/bots/docs/plans/*.md` (copied from the main checkout)

**Interfaces:**
- Produces: the worktree `C:\Users\Raghav\kc-worktrees\kc-bots` on branch
  `feat/bots-mvp`, with dependencies installed and hooks active.

- [x] **Step 1: Create the worktree**

Run: `git -C C:/Users/Raghav/Desktop/knightcode worktree add C:/Users/Raghav/kc-worktrees/kc-bots -b feat/bots-mvp main`
Expected: "Preparing worktree (new branch 'feat/bots-mvp')".

- [x] **Step 2: Copy the spec and plan into the worktree**

Run: `cp -r C:/Users/Raghav/Desktop/knightcode/apps/bots/docs C:/Users/Raghav/kc-worktrees/kc-bots/apps/bots/`
Expected: `apps/bots/docs/design.md` and the six plan files exist there. From
now on tick boxes only in the worktree copy.

- [x] **Step 3: Install and prepare**

Run in the worktree: `bun install --frozen-lockfile && bun x husky && bun run hydrate:model-data && git checkout -- packages/ai/src/providers/data/agentrouter.json`
Expected: exit 0; `git status` shows only `apps/bots/docs/` untracked.
(`hydrate:model-data` rewrites a tracked file that must be restored.)

- [x] **Step 4: Commit**

```bash
git add apps/bots/docs/design.md apps/bots/docs/plans
git commit -m "docs(bots): add the KnightCode Bots design and MVP plan"
```

### Task 0.2: The Worker skeleton

**Files:**
- Create: `apps/bots/package.json`, `apps/bots/wrangler.jsonc`,
  `apps/bots/tsconfig.json`, `apps/bots/vitest.config.ts`,
  `apps/bots/test/env.d.ts`, `apps/bots/test/apply-migrations.ts`,
  `apps/bots/migrations/0001_init.sql`, `apps/bots/src/worker.ts`,
  `apps/bots/src/env.ts`, `apps/bots/.gitignore`
- Test: `apps/bots/test/worker.test.ts`

**Interfaces:**
- Produces: `interface Env` in `src/env.ts` with bindings `DB: D1Database`,
  `FILES: R2Bucket`, `BOT: DurableObjectNamespace<BotObject>`,
  `USER: DurableObjectNamespace<UserObject>`,
  `COMPUTER: DurableObjectNamespace<ComputerObject>`,
  `OUTBOUND: Queue<OutboundMessage>`, `ASSETS: Fetcher`, and secrets
  `SESSION_SECRET: string`, `KEK: SecretsStoreSecret`. The Durable Object
  classes are exported from `src/worker.ts` as empty shells here and filled
  in by Part 2 and 3.

- [ ] **Step 1: Write the failing test**

```ts
// apps/bots/test/worker.test.ts
import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("answers health", async () => {
	const response = await SELF.fetch("https://bots.knightcode.dev/health");
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ ok: true });
});

it("refuses unknown API routes with a JSON 404", async () => {
	const response = await SELF.fetch("https://bots.knightcode.dev/api/nope");
	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({ error: "not_found" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest --run test/worker.test.ts` in `apps/bots`
Expected: FAIL (no worker yet).

- [ ] **Step 3: Implement the skeleton**

`package.json`: name `knightcode-bots`, private, `type: module`, scripts
`test` (`vitest --run`), `typecheck` (`tsc --noEmit`), `dev:worker`
(`wrangler dev`), `verify` (Task 4.5). Dev dependencies at the pinned
versions in Global Constraints. `wrangler.jsonc`: name `knightcode-bots`,
`main: src/worker.ts`, the compatibility date and flag, `workers_dev: true`,
no routes (Task 4.3 adds them), SQLite-backed Durable Object classes
`BotObject`, `UserObject`, `ComputerObject` in migration `v1`, D1
`knightcode-bots`, R2 `knightcode-bots-files`, queue producer and consumer
`bots-outbound` with dead-letter queue `bots-outbound-dlq`, assets
`./web/dist` with `run_worker_first: true`, `observability.enabled`. Mirror
`apps/remote/vitest.config.ts` and `test/env.d.ts` for the test pool, with
test values for every secret. `0001_init.sql` creates `accounts` (filled in
Task 2.1). `src/worker.ts` routes `/health` and returns JSON 404 for unknown
`/api/*`; other paths go to `ASSETS`. `.gitignore`: `.dev.vars`,
`.wrangler/`, `web/dist/`, `.emulate*`. Tests point the assets binding at
a committed `test/fixtures/assets/index.html` through the miniflare
override, since `web/dist` does not exist until the web app is built.
`src/env.ts` also exports `getKek(env): Promise<CryptoKey>`, which reads the
Secrets Store binding in production and a plain `TEST_KEK` binding in tests.

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx vitest --run test/worker.test.ts` and `bun run typecheck`
Expected: 2 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/bots/package.json apps/bots/wrangler.jsonc apps/bots/tsconfig.json apps/bots/vitest.config.ts apps/bots/test apps/bots/migrations apps/bots/src apps/bots/.gitignore bun.lock
git commit -m "feat(bots): add the KnightCode Bots Worker skeleton"
```

### Task 0.3: Contracts

**Files:**
- Create: `packages/bots-protocol/package.json`,
  `packages/bots-protocol/src/index.ts`, `src/entities.ts`, `src/recipe.ts`,
  `src/api.ts`, `src/frames.ts`, `src/validate.ts`, `src/avatars.ts`
- Test: `packages/bots-protocol/test/protocol.test.ts`

**Interfaces:**
- Produces (package `@knightcode/bots-protocol`, TypeBox schemas and their
  `Static` types):
  - `AVATAR_SHAPES: readonly AvatarShape[]` (the 25 names from spec
    section 5's recipe mapping, in the order of the reference notes);
    `AvatarSchema = { shape: AvatarShape; color: string }`.
  - Entities: `Account`, `Bot` (id, name, purpose, instructionsVersion,
    model `{ provider: string; modelId: string; thinking?: string }`, avatar,
    approvals, computerAccess, notify), `Group`, `Routine` (id, botId, name,
    prompt, triggers, grant, active, model?), `Trigger` (union by `kind`:
    `schedule`, `github`, `slack`, `email`, `composio`, `webhook`, `watch`),
    `Grant` (actions, targets, limits), `CatalogEntry` (id, name, maker,
    category, icon, auth, skills, usageNote, permissions), `Skill`, `Page`
    and `PageBlock` (union: `text`, `table`, `chart`, `image`, `file`,
    `widget`, `button`), `InboxItem`, `Task`, `Approval` (id, digest, action,
    expiresAt, state), `VaultItem` (metadata only: id, kind, name, origin),
    `UsageRow`, `ComputerState`, `ChannelLink`.
  - `RecipeSchema` exactly as spec section 5, and
    `parseRecipe(json: unknown): Recipe` that enforces
    `gettingStarted.skill` naming one of `skills` and a 25 MB size cap.
  - `ROUTES`: a table of `{ name, method, path, request, response }` for
    every HTTP call the UI makes; `createApiClient(fetch: typeof fetch,
    base: string): ApiClient` typed from it, one method per route `name`
    (including `createBot`, `listBots`, `updateBot`, `listModels`,
    `answerApproval`, `listInbox`, `listCatalog`, `connectApp`,
    `createRoutine`, `putVault`, `listVault`, `topUp`, `issueTicket`).
  - The package is covered by the root `tsc` (it lives under
    `packages/*/src`); add `@knightcode/bots-protocol` to the root
    `tsconfig.json` `paths` in the same commit.
  - `ClientFrame` (union by `type`: `auth`, `subscribe`, `unsubscribe`,
    `submit`, `stop`, `answer`) and `ServerFrame` (`ready`, `view`, `ops`,
    `event`, `error`); `encodeFrame`, `decodeFrame`.
  - `parse<T>(schema: TSchema, value: unknown): T` throwing
    `ProtocolError { path, message }`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/bots-protocol/test/protocol.test.ts
import { describe, expect, it } from "vitest";
import { AVATAR_SHAPES, decodeFrame, encodeFrame, parseRecipe, ROUTES } from "../src/index.ts";

describe("contracts", () => {
	it("knows the 25 avatar shapes", () => {
		expect(AVATAR_SHAPES).toHaveLength(25);
		expect(new Set(AVATAR_SHAPES).size).toBe(25);
	});
	it("parses a recipe and rejects a getting-started skill it does not contain", () => {
		const recipe = { profile: { name: "Inbox", description: "Triage mail" }, memory: [], skills: [{ name: "triage", description: "d", content: "c" }], routines: [], plugins: [], gettingStarted: { skill: "triage" } };
		expect(parseRecipe(recipe).profile.name).toBe("Inbox");
		expect(() => parseRecipe({ ...recipe, gettingStarted: { skill: "missing" } })).toThrow(/gettingStarted/);
	});
	it("round-trips frames and rejects unknown types", () => {
		const frame = { type: "submit", botId: "b1", text: "hi", requestId: "r1" } as const;
		expect(decodeFrame(encodeFrame(frame))).toEqual(frame);
		expect(() => decodeFrame(JSON.stringify({ type: "nope" }))).toThrow();
	});
	it("has one route per method and path", () => {
		const keys = ROUTES.map((r) => `${r.method} ${r.path}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bunx vitest --run` in `packages/bots-protocol`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the schemas and helpers in the listed files**

One schema per entity, unions discriminated by `kind` or `type`. Every
route the Part 1 screens need is in `ROUTES`; add routes there first when a
later task needs one, never ad hoc.

- [ ] **Step 4: Run them to verify they pass**

Run: `bunx vitest --run` and `bunx tsc --noEmit` in `packages/bots-protocol`
Expected: 4 passed; no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/bots-protocol bun.lock
git commit -m "feat(bots): add the client contracts for KnightCode Bots"
```

### Task 0.4: The fake backend

**Files:**
- Create: `packages/bots-protocol/src/fake/index.ts`, `fake/seed.ts`,
  `fake/socket.ts`, `fake/stream.ts`
- Test: `packages/bots-protocol/test/fake.test.ts`

**Interfaces:**
- Consumes: Task 0.3's schemas, `ROUTES`, frames.
- Produces: `createFakeBackend(seed?: FakeSeed): FakeBackend` with
  `fetch(request: Request): Promise<Response>` serving every `ROUTES` entry,
  `connect(): WebSocketLike` speaking the frames, and `clock` controls for
  tests. `defaultSeed(): FakeSeed` (bots with ids `reviewer`, `inbox`,
  `social` and `chief`; group `launch`; routines with each trigger kind;
  catalog entries in every category, including `gmail`; skills; pages
  `weekly` and `roadmap`; inbox items of every kind, with one needs-you item;
  vault metadata; usage rows; handle `raghav`). Part 1's URLs use these ids. `loadSeed(path)` reads a
  JSON seed (used by Part 1's reference comparison). The fake follows the
  real semantics for approvals (consumed once) and streaming (partial
  updates, then the final entry).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/bots-protocol/test/fake.test.ts
import { expect, it } from "vitest";
import { createApiClient, createFakeBackend, decodeFrame, encodeFrame } from "../src/index.ts";

it("creates a bot through the API", async () => {
	const fake = createFakeBackend();
	const api = createApiClient(fake.fetch, "https://bots.test");
	const bot = await api.createBot({ name: "Reviewer" });
	expect((await api.listBots({})).bots.map((b) => b.id)).toContain(bot.id);
});

it("streams a reply as view, ops, and a final assistant entry", async () => {
	const fake = createFakeBackend();
	const socket = fake.connect();
	const frames: unknown[] = [];
	socket.addEventListener("message", (e) => frames.push(decodeFrame(String(e.data))));
	socket.send(encodeFrame({ type: "auth", ticket: "fake" }));
	socket.send(encodeFrame({ type: "subscribe", botId: fake.seed.bots[0].id }));
	socket.send(encodeFrame({ type: "submit", botId: fake.seed.bots[0].id, text: "hello", requestId: "r1" }));
	await fake.clock.runAll();
	expect(frames.some((f: any) => f.type === "view")).toBe(true);
	expect(frames.filter((f: any) => f.type === "ops").length).toBeGreaterThan(1);
});

it("runs an approved action once even when answered twice", async () => {
	const fake = createFakeBackend();
	const api = createApiClient(fake.fetch, "https://bots.test");
	const [approval] = fake.seed.approvals;
	await Promise.all([api.answerApproval({ id: approval.id, decision: "allow" }), api.answerApproval({ id: approval.id, decision: "allow" })]);
	expect(fake.executed(approval.id)).toBe(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bunx vitest --run test/fake.test.ts` in `packages/bots-protocol`
Expected: FAIL.

- [ ] **Step 3: Implement `createFakeBackend` in `src/fake/`**

State is plain in-memory objects; streaming uses the injectable clock so
tests and screenshots are deterministic.

- [ ] **Step 4: Run them to verify they pass**

Run: `bunx vitest --run` in `packages/bots-protocol`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add packages/bots-protocol/src/fake packages/bots-protocol/test/fake.test.ts
git commit -m "feat(bots): add an in-memory fake backend for UI work and tests"
```
