# Part 2: Backend core

Spec sections: 4, 5, 6, 13, 15, 16, 21 (vault), 24. Start only when every
Part 1 box is ticked.

Test harness used by every task here (built in Task 2.1, step 3): the
async factory in `apps/bots/vitest.config.ts` (it runs in Node) starts the
`emulate` services the suite needs with `port: 0` and passes their URLs to
the Worker as miniflare bindings (`EMULATE_GITHUB_URL`,
`EMULATE_GOOGLE_URL`, `EMULATE_SLACK_URL`, `EMULATE_STRIPE_URL`, and the
custom Telegram, Composio and Plaid emulators); `test/global-setup.ts`
stops them in its teardown. Where these files say `inject("githubUrl")`,
read `env.EMULATE_GITHUB_URL`. `apps/bots/test/fake-model.ts` exports
`fakeModelProvider(script: FakeTurn[]): Provider`, an in-process
`@knightcode/ai` provider that streams scripted text and tool calls;
`setModelsFactory(factory)` (exported from `src/bot/models.ts`) swaps it in
for tests. If module state set in a test is not visible inside the Durable
Object, pass the script as a `TEST_MODEL_SCRIPT` binding instead and have
`models.ts` read it only when `env.TEST_MODE` is set. Production builds
`builtinModels({ credentials })`.

### Task 2.1: Accounts and sign-in

**Files:**
- Create: `apps/bots/src/auth/oauth.ts`, `auth/email-code.ts`,
  `auth/passkeys.ts`, `auth/session.ts`, `auth/tickets.ts`,
  `auth/handle.ts`, `apps/bots/migrations/0002_accounts.sql`,
  `apps/bots/test/global-setup.ts`, `apps/bots/test/fake-model.ts`,
  `apps/bots/emulate.config.ts`
- Modify: `apps/bots/src/worker.ts`, `apps/bots/vitest.config.ts`
- Test: `apps/bots/test/auth.test.ts`

**Interfaces:**
- Produces:
  - `startOAuth(env: Env, provider: "github" | "google", next: string): Response`
    and `completeOAuth(env, request): Promise<Response>` (sets the session
    cookie, creates the account on first sign-in, redirects to handle
    choice).
  - `sendEmailCode(env, email): Promise<void>`,
    `verifyEmailCode(env, email, code): Promise<AccountId | undefined>`
    (6 digits, 10 minutes, 5 attempts).
  - `beginPasskey(env, accountId?)`, `finishPasskey(env, response)` with
    `@simplewebauthn/server`.
  - `issueSession(env, accountId): Promise<string>` (HttpOnly, Secure,
    SameSite=Lax cookie), `readSession(env, request): Promise<Principal | undefined>`.
  - `issueTicket(env, principal, scope: TicketScope, ttlMs = 60_000): Promise<string>`,
    `verifyTicket(env, ticket): Promise<Principal | undefined>`.
  - `claimHandle(db, accountId, handle): Promise<"ok" | "taken" | "invalid" | "reserved">`
    (lowercase letters, digits, hyphens, 3 to 20 characters; the reserved
    list of spec section 10).
  - `type Principal = { accountId: string; workspaceId: string; client: "web" | "desktop" | "cli" }`.

- [x] **Step 1: Write the failing tests**

```ts
// apps/bots/test/auth.test.ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { claimHandle } from "../src/auth/handle.ts";
import { issueTicket, verifyTicket } from "../src/auth/tickets.ts";

describe("sign-in", () => {
	it("signs in with GitHub against the emulator and sets a session cookie", async () => {
		const start = await SELF.fetch("https://bots.knightcode.dev/auth/github?next=/", { redirect: "manual" });
		expect(start.status).toBe(302);
		const done = await followEmulatorConsent(start.headers.get("location")!);
		expect(done.headers.get("set-cookie")).toMatch(/HttpOnly; Secure; SameSite=Lax/);
	});
	it("refuses state-changing requests from another origin", async () => {
		const response = await SELF.fetch("https://bots.knightcode.dev/api/bots", { method: "POST", headers: { origin: "https://evil.example", cookie: await sessionCookie() }, body: "{}" });
		expect(response.status).toBe(403);
	});
	it("validates handles", async () => {
		expect(await claimHandle(env.DB, "a1", "Raghav")).toBe("invalid");
		expect(await claimHandle(env.DB, "a1", "admin")).toBe("reserved");
		expect(await claimHandle(env.DB, "a1", "raghav")).toBe("ok");
		expect(await claimHandle(env.DB, "a2", "raghav")).toBe("taken");
	});
	it("expires tickets", async () => {
		const ticket = await issueTicket(env, { accountId: "a1", workspaceId: "w1", client: "desktop" }, "socket", 1);
		await new Promise((r) => setTimeout(r, 5));
		expect(await verifyTicket(env, ticket)).toBeUndefined();
	});
});
```

(`followEmulatorConsent` and `sessionCookie` are helpers in
`test/helpers.ts` that drive the emulator's consent page and create a test
account.)

- [x] **Step 2: Run them to verify they fail**

Run: `bunx vitest --run test/auth.test.ts` in `apps/bots`
Expected: FAIL.

- [x] **Step 3: Build the test harness, then implement sign-in**

Global setup, fake model, emulate config, then the listed auth modules.
Origin checks apply to every non-GET API request and WebSocket upgrade.

- [x] **Step 4: Run them to verify they pass**

Run: `bunx vitest --run test/auth.test.ts`
Expected: 4 passed.

- [x] **Step 5: Commit**

```bash
git add apps/bots/src/auth apps/bots/src/worker.ts apps/bots/migrations/0002_accounts.sql apps/bots/test apps/bots/emulate.config.ts apps/bots/vitest.config.ts bun.lock
git commit -m "feat(bots): add sign-in with GitHub, Google, email codes and passkeys"
```

### Task 2.2: Envelope encryption and sealed archives

**Files:**
- Create: `apps/bots/src/crypto/envelope.ts`, `crypto/archive.ts`
- Test: `apps/bots/test/crypto.test.ts`

**Interfaces:**
- Produces:
  - `createDataKey(kek: CryptoKey): Promise<{ key: CryptoKey; wrapped: string }>`,
    `unwrapDataKey(kek, wrapped): Promise<CryptoKey>`.
  - `seal(key, plaintext: Uint8Array, aad: string): Promise<string>`,
    `open(key, sealed: string, aad: string): Promise<Uint8Array>`
    (AES-256-GCM, random 96-bit IV, AAD binds the record id).
  - `sealArchive(key, source: AsyncIterable<Uint8Array>, ids: { storageId: string; generation: number }): { segments: AsyncIterable<Uint8Array>; manifest: Promise<ArchiveManifest> }`
    in 64 KiB segments, each bound to storage id, generation and index;
    `ArchiveManifest = { storageId, generation, segments: number, bytes: number, tag: string }`
    where `tag` authenticates the ordered list of segment tags.
  - `openArchive(key, segments, manifest): AsyncIterable<Uint8Array>`
    rejecting a missing, extra, reordered or altered segment.

- [x] **Step 1: Write the failing tests**

```ts
// apps/bots/test/crypto.test.ts
import { expect, it } from "vitest";
import { createDataKey, open, seal } from "../src/crypto/envelope.ts";
import { openArchive, sealArchive } from "../src/crypto/archive.ts";

it("seals and opens, and refuses another record's AAD", async () => {
	const { key } = await createDataKey(await testKek());
	const sealed = await seal(key, new TextEncoder().encode("secret"), "vault:1");
	expect(new TextDecoder().decode(await open(key, sealed, "vault:1"))).toBe("secret");
	await expect(open(key, sealed, "vault:2")).rejects.toThrow();
});

it("rejects reordered and truncated archives", async () => {
	const { key } = await createDataKey(await testKek());
	const { segments, manifest } = sealArchive(key, chunks(200_000), { storageId: "s", generation: 3 });
	const parts = await collect(segments);
	await expect(collect(openArchive(key, toIterable([parts[1], parts[0], ...parts.slice(2)]), await manifest))).rejects.toThrow();
	await expect(collect(openArchive(key, toIterable(parts.slice(0, -1)), await manifest))).rejects.toThrow();
	expect((await collect(openArchive(key, toIterable(parts), await manifest))).length).toBeGreaterThan(0);
});
```

- [x] **Step 2: Run them to verify they fail** (`bunx vitest --run test/crypto.test.ts`)
- [x] **Step 3: Implement with Web Crypto only** (no new dependency)
- [x] **Step 4: Run them to verify they pass**
- [x] **Step 5: Commit**

```bash
git add apps/bots/src/crypto apps/bots/test/crypto.test.ts
git commit -m "feat(bots): add envelope encryption and sealed archives"
```

### Task 2.3: A transport abstraction in `packages/env`

**Files:**
- Modify: `packages/env/src/connection.ts`, `packages/env/src/remote-env.ts`,
  `packages/env/src/index.ts`
- Create: `packages/env/src/transport.ts`
- Test: `packages/env/test/transport.test.ts`

**Interfaces:**
- Produces: `interface Transport { send(frame: Uint8Array): void; onFrame(listener: (frame: Uint8Array) => void): void; onClose(listener: (reason: string) => void): void; close(): void }`;
  `childProcessTransport(options)` (today's behaviour, moved out of
  `Connection`); `webSocketTransport(socket: WebSocketLike)`; `Connection`
  constructed from a `Transport`. Framing, cancellation, session handles and
  unknown-outcome errors are unchanged.

- [ ] **Step 1: Write the failing test**: the existing env conformance suite
  (`createEnvConformance` from `@knightcode/durable/testing`) passes over
  both a child-process transport and an in-memory WebSocket pair talking to
  the daemon; an interrupted write over the WebSocket transport reports an
  unknown outcome, exactly as the child-process one does.
- [ ] **Step 2: Run it to verify it fails** (`bunx vitest --run test/transport.test.ts` in `packages/env`)
- [ ] **Step 3: Extract `Transport` and add the WebSocket transport**
- [ ] **Step 4: Run the whole env suite** (`bunx vitest --run` in `packages/env`)
  Expected: all existing tests and the new one pass, on Windows too.
- [ ] **Step 5: Commit** (this commit touches only `packages/env`)

```bash
git add packages/env/src packages/env/test/transport.test.ts
git commit -m "feat(env): run a remote environment over any transport"
```

### Task 2.4: The user object: vault, credentials, balance

**Files:**
- Create: `apps/bots/src/user/user-object.ts`, `user/vault.ts`,
  `user/credentials.ts`, `user/enrollment.ts`, `user/balance.ts`,
  `user/journal.ts`, `user/files.ts`, `apps/bots/migrations/0003_journal.sql`
- Test: `apps/bots/test/user.test.ts`

**Interfaces:**
- Consumes: Task 2.2's envelope functions; `CredentialStore` from
  `@knightcode/ai`.
- Produces (RPC methods on `UserObject`):
  - `vaultPut(item: VaultInput): Promise<VaultItem>`, `vaultList(): Promise<VaultItem[]>`
    (metadata only), `vaultDelete(id)`, and internal
    `vaultReveal(id, purpose: "inject" | "fill"): Promise<string>` callable
    only from server-side tool code, never from a client route.
  - `credentials(): CredentialStore` backed by the vault, with `modify()`
    serialized per provider by one in-flight promise.
  - `beginEnrollment(provider): Promise<{ token: string; expiresAt: number }>`
    and `completeEnrollment(token, credential): Promise<void>` (10-minute
    token, single use).
  - `reserve(kind: "computer" | "composio" | "bank", units: number): Promise<Reservation | "insufficient">`,
    `settle(reservationId, usedUnits): Promise<void>` (idempotent),
    `balance(): Promise<Balance>`; every change appends to the journal.
  - The file store (spec section 8): `putFile(meta, body): Promise<FileRef>`,
    `getFile(ref)`, `listFiles({ botId?, kind? })`, objects in R2 sealed with
    the user's data key, kinds `attachment`, `bot-output`, `knowledge`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/bots/test/user.test.ts
it("refreshes a shared OAuth credential once for two concurrent callers", async () => {
	const user = userStub("a1");
	await seedExpiredOAuth(user, "anthropic");
	const refreshes = countTokenEndpointCalls();
	await Promise.all([resolveAuth(user, "anthropic"), resolveAuth(user, "anthropic")]);
	expect(refreshes()).toBe(1);
});
it("never returns a vault value through the API", async () => {
	await apiPost("/api/vault", { kind: "api", name: "x", origin: "https://api.example", value: "s3cret" });
	const body = await (await apiGet("/api/vault")).text();
	expect(body).not.toContain("s3cret");
});
it("reserves before spending and settles once", async () => {
	const user = userStub("a1");
	await grantCredits(user, 100);
	const r = await user.reserve("computer", 1);
	expect(r).not.toBe("insufficient");
	await user.settle((r as Reservation).id, 1);
	await user.settle((r as Reservation).id, 1);
	expect((await user.balance()).spent).toBe(unitCost("computer"));
});
it("stores files sealed and lists knowledge files per bot", async () => {
	const user = userStub("a1");
	const ref = await user.putFile({ name: "brand.md", kind: "knowledge", botId: "b1" }, "Use teal");
	expect(await rawR2Text(ref)).not.toContain("Use teal");
	expect((await user.listFiles({ botId: "b1", kind: "knowledge" })).map((f) => f.name)).toEqual(["brand.md"]);
});
it("refuses to reserve past the spending limit", async () => {
	const user = userStub("a1");
	await setSpendingLimit(user, 0);
	expect(await user.reserve("computer", 1)).toBe("insufficient");
});
```

- [ ] **Step 2: Run them to verify they fail** (`bunx vitest --run test/user.test.ts`)
- [ ] **Step 3: Implement the user object in the listed files**
- [ ] **Step 4: Run them to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add apps/bots/src/user apps/bots/migrations/0003_journal.sql apps/bots/test/user.test.ts
git commit -m "feat(bots): add the user object with vault, credentials and balance"
```

### Task 2.5: The bot object: harness, alarms, live view

**Files:**
- Create: `apps/bots/src/bot/bot-object.ts`, `bot/models.ts`,
  `bot/scheduler.ts`, `bot/socket.ts`, `bot/principal.ts`
- Test: `apps/bots/test/bot.test.ts`, `apps/bots/test/scheduler.test.ts`

**Interfaces:**
- Consumes: `@knightcode/durable` (`Harness`, `openDurableObjectSqliteStorage`,
  `ConversationTranscript`), `UserObject.credentials()`, `verifyTicket`.
- Produces:
  - `nextAlarm(input: { wake: Wake; routineDeadlines: number[]; now: number; heartbeatMs: number }): number | undefined`
    (pure).
  - `BotObject` RPC: `submit(principal, text, requestId)`, `stop(principal)`,
    `routineFire(routineId, firedAt)`; `fetch` upgrades WebSockets that
    authenticate with a ticket in their first frame, then stream `view` and
    `ops` frames from `conversation.watch()`, resuming with
    `transcript.resume` on reconnect.
  - `assertOwns(principal, botId)` on every RPC and frame.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/bots/test/bot.test.ts
it("resumes a dropped stream with no gap and no duplicate text", async () => {
	setModelsFactory(fakeModels([{ text: "one two three four five" }]));
	const first = await openSocket("b1");
	await first.submit("go");
	await first.untilText("two");
	first.drop();
	const second = await openSocket("b1", first.resumeToken);
	const text = await second.untilDone();
	expect(text).toBe("one two three four five");
});
it("resumes work after eviction with no client connected", async () => {
	setModelsFactory(fakeModels([{ text: "done", delayMs: 50 }]));
	await botStub("b1").submit(principal, "go", "r1");
	await evict("b1");
	await runAlarm("b1");
	expect(await lastAssistantText("b1")).toBe("done");
});
it("refuses another account's socket and RPC", async () => {
	await expect(openSocket("b1", undefined, otherAccountTicket())).rejects.toThrow(/unauthorized/);
});
```

```ts
// apps/bots/test/scheduler.test.ts
it("arms the earliest of heartbeat, sleep and routine deadline", () => {
	expect(nextAlarm({ wake: { active: true, at: 5_000 }, routineDeadlines: [9_000], now: 0, heartbeatMs: 60_000 })).toBe(5_000);
	expect(nextAlarm({ wake: { active: false }, routineDeadlines: [], now: 0, heartbeatMs: 60_000 })).toBeUndefined();
});
```

- [ ] **Step 2: Run them to verify they fail** (`bunx vitest --run test/bot.test.ts test/scheduler.test.ts`)
- [ ] **Step 3: Implement the bot object** following the Durable Object host
  pattern in `packages/durable/README.md` ("Persist and Resume"): a fallback
  alarm before opening, `onWake` arming, arming before every call that can
  start work.
- [ ] **Step 4: Run them to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add apps/bots/src/bot apps/bots/test/bot.test.ts apps/bots/test/scheduler.test.ts
git commit -m "feat(bots): run each bot in a durable object with a live view"
```

### Task 2.6: Actions, approvals, grants and provenance

**Files:**
- Create: `apps/bots/src/bot/actions.ts`, `bot/approvals.ts`,
  `bot/grants.ts`, `bot/provenance.ts`, `bot/policy.ts`,
  `apps/bots/src/delivery/queue.ts`
- Test: `apps/bots/test/actions.test.ts`

**Interfaces:**
- Produces:
  - `type WriteAdapter = { id: string; kind: "idempotent" | "reconcilable" | "neither"; send(action: ActionRecord): Promise<DeliveryResult>; check?(action: ActionRecord): Promise<"done" | "not_done" | "unknown"> }`.
  - `recordAction(tx, intent: ActionIntent): ActionRecord` (stable id,
    state `pending`), `dispatch(record, adapter)`, the queue consumer that
    never re-sends a `neither` action whose outcome is unknown.
  - `createApproval(action, policyVersion, ttlMs): Approval` with a SHA-256
    digest of the canonical action; `consumeApproval(id, digest): Promise<"ok" | "used" | "changed" | "expired" | "revoked">`.
  - `withinGrant(grant: Grant, intent: ActionIntent): boolean`.
  - `markOutside(runId, source)`, `isOutside(runId): boolean`, inherited by
    steers, helpers, bot messages and continuation runs.
  - `decide(input: { action: ActionIntent; mode: "never" | "auto" | "ask"; allow: Rule[]; block: Rule[]; outside: boolean; grant?: Grant; reviewer?: ModelRef }): Promise<"run" | "ask" | "refuse">`:
    Block refuses in every mode; outside runs act only within the grant;
    Auto asks the user's chosen reviewer model and asks the user when it
    errors or is unsure; Ask asks before any change.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/bots/test/actions.test.ts
it("runs an approved action once when two devices answer together", async () => {
	const approval = await createTestApproval("b1", sendEmail("a@b.c"));
	const results = await Promise.all([answer(approval.id, "allow"), answer(approval.id, "allow")]);
	expect(results.sort()).toEqual(["ok", "used"]);
	expect(await sentCount("a@b.c")).toBe(1);
});
it("rejects an approval after the action changed", async () => {
	const approval = await createTestApproval("b1", sendEmail("a@b.c"));
	expect(await consumeApproval(approval.id, digestOf(sendEmail("x@y.z")))).toBe("changed");
});
it("never re-sends a 'neither' action with an unknown outcome", async () => {
	const adapter = flakyAdapter({ kind: "neither", failAfterSend: true });
	await deliverWithRetries(adapter, sendEmail("a@b.c"));
	expect(adapter.sends).toBe(1);
	expect(await actionState()).toBe("unknown");
});
it("decides by mode, lists, grant and provenance", async () => {
	const post = commentOnPr("owner/repo");
	expect(await decide({ action: post, mode: "never", allow: [], block: [rule(post)], outside: false })).toBe("refuse");
	expect(await decide({ action: post, mode: "never", allow: [], block: [], outside: true })).toBe("ask");
	expect(await decide({ action: post, mode: "never", allow: [], block: [], outside: true, grant: grantFor(post) })).toBe("run");
	expect(await decide({ action: post, mode: "auto", allow: [], block: [], outside: false, reviewer: failingReviewer() })).toBe("ask");
});
it("keeps the outside mark through a helper and a bot message", async () => {
	markOutside("run1", "email");
	const helper = await spawnHelper("run1");
	const next = await messageBotFrom(helper);
	expect(isOutside(next)).toBe(true);
});
```

- [ ] **Step 2: Run them to verify they fail** (`bunx vitest --run test/actions.test.ts`)
- [ ] **Step 3: Implement the listed modules** (the approval waits as its
  own task, so the conversation keeps running)
- [ ] **Step 4: Run them to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add apps/bots/src/bot/actions.ts apps/bots/src/bot/approvals.ts apps/bots/src/bot/grants.ts apps/bots/src/bot/provenance.ts apps/bots/src/delivery apps/bots/test/actions.test.ts
git commit -m "feat(bots): add action records, single-use approvals and grants"
```

### Task 2.7: Memory

**Files:**
- Create: `apps/bots/src/memory/notes.ts`, `memory/index-file.ts`,
  `memory/search.ts`, `memory/recall.ts`, `memory/extract.ts`,
  `memory/dream.ts`, `memory/shared.ts`, `memory/history-tools.ts`,
  `memory/open-work.ts`, `memory/import.ts`
- Test: `apps/bots/test/memory.test.ts`, `apps/bots/test/recall-evals.test.ts`

**Interfaces:**
- Produces:
  - `NotesStore` over the bot object's SQLite: `write(note)`,
    `list()`, `get(name)`, `delete(name)`, `indexText(): string` (one line
    per note, never content).
  - `searchNotes(query, { limit }): Promise<NoteHit[]>`: FTS5 plus
    meaning-based scores when the user's connected provider offers an
    embedding model (chosen by the user, never hardcoded), recency weight
    for non-evergreen notes.
  - `selectRecall({ message, candidates, inPrompt: Set<string>, helper }): Promise<string[]>`
    (at most 5; skipped when every note fits or there is no candidate).
  - `extractAfterRun(run)`, `dream(bot, { minHours: 24, minRuns: 5 })`.
  - Tools `search_history({ query, from?, to?, cursor? })` and
    `read_history({ ref, before?, after?, cursor? })` with bounded output
    and an access check on every call.
  - `shareNotes(names)` with a privacy check that reports how many it kept
    back; notes written by an outside-marked run need approval to share.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/bots/test/memory.test.ts
it("makes a note eligible again after compaction drops it", async () => {
	await writeNote("b1", { name: "tea", description: "likes tea", body: "Prefers green tea" });
	await recallFor("b1", "what tea?");
	await compactAway("b1", "tea");
	expect(await recallFor("b1", "what tea again?")).toContain("tea");
});
it("finds a reworded fact with no shared keyword when embeddings exist", async () => {
	await withEmbeddings(async () => {
		await writeNote("b1", { name: "drink", description: "beverage preference", body: "Prefers green tea" });
		expect(await recallFor("b1", "what should I brew for them?")).toContain("drink");
	});
});
it("labels ages older than a day", async () => {
	expect(await renderRecalled("b1", { ageDays: 47 })).toContain("47 days ago");
});
it("search_history refuses a message id from another bot", async () => {
	await expect(callTool("b1", "read_history", { ref: refFromBot("b2") })).rejects.toThrow(/not found/);
});
```

`recall-evals.test.ts` builds seeded chats of 100, 1,000 and 10,000
messages with the fake model and checks that facts, reworded facts, dates,
later-changed decisions and open work are recalled.

- [ ] **Step 2: Run them to verify they fail** (`bunx vitest --run test/memory.test.ts test/recall-evals.test.ts`)
- [ ] **Step 3: Implement memory in the listed files** (context assembled
  by rules; stable instructions first, changing memory last; summaries reused
  until their messages change)
- [ ] **Step 4: Run them to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add apps/bots/src/memory apps/bots/test/memory.test.ts apps/bots/test/recall-evals.test.ts
git commit -m "feat(bots): add bot memory, recall, consolidation and history search"
```

### Task 2.8: Tools: lazy loading, settings, help, images, web

**Files:**
- Create: `apps/bots/src/tools/catalog.ts`, `tools/settings-tool.ts`,
  `tools/help-skill.ts`, `tools/image-tool.ts`, `tools/web-fetch.ts`,
  `apps/bots/scripts/tool-budget.ts`
- Test: `apps/bots/test/tools.test.ts`

**Interfaces:**
- Produces: the bot's tool set as a durable extension
  (`defineExtension({ name: "bots-core", tools })`) with a short core list
  plus `tool_search` (from `@knightcode/durable/tool-search`) over
  connectors, skills and built-ins; `update_bot` (reads without fields,
  patches with fields, never widens powers); the help skill reading
  `apps/bots/docs/help/*.md`; `generate_image` only when the user's
  provider has an image model; a fetch-based web search and fetch adapter
  for Workers; `tool-budget.ts` failing when the visible tool definitions
  exceed 6 KB; the bot's knowledge files (Task 2.4's `listFiles`) listed in
  its context by name and readable through a `read_knowledge` tool.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/bots/test/tools.test.ts
it("keeps the visible tool list under budget", async () => {
	expect(await visibleToolBytes("b1")).toBeLessThan(6 * 1024);
});
it("refuses to widen powers from chat", async () => {
	await expect(callTool("b1", "update_bot", { computerAccess: true })).rejects.toThrow(/settings/);
	expect(await callTool("b1", "update_bot", { name: "Rex" })).toMatchObject({ name: "Rex" });
});
it("hides image generation without an image model", async () => {
	expect(await toolNames("b1-no-image-provider")).not.toContain("generate_image");
});
```

- [ ] **Step 2: Run them to verify they fail** (`bunx vitest --run test/tools.test.ts`)
- [ ] **Step 3: Implement the tools in the listed files**
- [ ] **Step 4: Run them to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add apps/bots/src/tools apps/bots/scripts/tool-budget.ts apps/bots/test/tools.test.ts
git commit -m "feat(bots): add lazy tools, settings from chat, help and images"
```
