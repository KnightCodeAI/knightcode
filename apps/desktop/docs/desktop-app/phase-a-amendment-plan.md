# Phase A amendment (protocol 2): implementation plan

> **Status (2026-10-15): implemented, then revised.** The parts of this plan that changed
> `packages/agent`, `packages/ai`, `AgentSession`'s queue and `SettingsManager` were moved into
> the app server, and the protocol has no version number. architecture.md section 4.7 is the
> current design; read this plan as history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the shipped Phase A app server from protocol 1 to protocol 2, the shape the desktop app (desktop-shell.md) is built against, before any client ships.

**Architecture:** Every change is a vertical slice: the TypeBox schema in `@knightcode/app-server-protocol`, the server code that produces or consumes it, and a test through the in-process client. Live notifications (`item-mapper.ts`) and read-back (`transcript.ts`) keep computing every new field with one shared function, so a client sees the same data live and after `thread/read`. Three small core changes support it: an error classifier beside the retry classifier in `packages/ai`, removable queue entries in `packages/agent` and `AgentSession`, and a compare-and-swap settings write in `SettingsManager`.

**Tech Stack:** TypeScript on Bun 1.3, TypeBox 1.3.27, Vitest, the faux provider (`fauxProvider`, `fauxAssistantMessage`, `fauxText`, `fauxToolCall` from `@knightcode/ai`), `fd` through `ensureTool` for file search.

**Spec:** `apps/desktop/docs/desktop-app/architecture.md`, section 4.6 (the list of protocol 2 changes) and the sections it points to: 4.1, 4.2 (types, timestamps, error kind, file change diffs), 4.3, 4.4, 4.5, 5.4 (approvals), 5.10 (listing index), 11 (protocol 2 tests), 13 (validation). `desktop-shell.md` section 13 lists why the desktop needs each change. Section numbers below (§) refer to architecture.md.

## Execution progress

Progress is tracked in `.superpowers/sdd/phase-a-amendment-plan/progress.md`.
No commits have been authorized. Tasks are marked complete only after their
selected tests and the root type check pass.

- [x] Task 0 — production-handler harness and abortable held-turn fixture (182 app-server tests).
- [x] Task 1 — protocol 2 handshake, opt-outs, platform and final diagnostics schema (29 selected tests).
- [x] Task 2 — object status, lock-loss recovery, creation time and header-based fork origin (188 app-server tests).
- [x] Task 3 — error kinds, timestamps and sidebar outcomes (207 CLI tests).
- [x] Task 4 — diffs, client message ids and image paths (209 app-server tests).
- [x] Task 5 — turn identity and removable queues (109 agent; 215 CLI tests).
- [x] Task 6 — usage and thinking levels (218 app-server tests).
- [x] Task 7 — approval prefixes and reasons (226 app-server tests).
- [x] Task 8 — settings, warnings and trust (322 selected CLI tests).
- [x] Task 9 — bounded file search (246 app-server tests).
- [x] Task 10 — deletion and unsubscribe status (257 app-server tests).
- [x] Task 11 — listing index (266 app-server tests).
- [x] Task 12 — docs, changeset, benchmarks and final validation (288 CLI, 49 AI, 109 agent, 6 protocol tests; eight Windows/WSL2 benchmark runs).

Not in this plan: worktree changes of §6.1 (`carryLocalChanges`, worktree settings, `thread/workspace/progress`); they belong to the Phase B plan with the rest of §6.

## Global Constraints

- Formatting is Prettier: tabs, 120 columns, LF. `bun run format` before each commit.
- No `any`. No inline imports (`await import()`, `import("x").T`). `erasableSyntaxOnly`: no parameter properties, `enum`, `namespace`; explicit fields assigned in constructors.
- `packages/app-server-protocol/src` imports nothing from `@knightcode/ai` or `@knightcode/agent`.
- No `exec(`, `execSync(` or `shell: true` under `packages/cli/src/app-server`. Child processes use `spawn` with an argument array.
- Windows and POSIX: `node:path` for joins, `resolvePath` for user-supplied paths. LF in all files.
- No system-prompt text. No model names in product code; tests use the faux model.
- Tests never touch the real `~/.knightcode`: `startServer()` (`test/app-server/harness.ts`) gives temp `agentDir`, `sessionDir` and `cwd`. Faux provider only; no real keys or paid tokens.
- Race tests never sleep a fixed time and never rely on how fast a reply streams (`tokensPerSecond`); they wait on a gate or a notification (`waitFor`). A test that needs a turn to stay running uses Task 0's held turn, and releases it in a `finally` so a failed assertion cannot leave the turn waiting; the held tool also ends on abort, so cleanup cannot hang either way. Timers run under Vitest fake timers.
- Task 0 runs first: every later test assumes its harness (production handler set) and fixture.
- Live and read-back agree: every field this plan adds to an item or a turn is checked both from notifications and from `thread/read` in the same test (`expectReadBackMatches` in `turns.test.ts` is the model).
- `PROTOCOL_VERSION` is 2 after Task 1. There is no protocol 1 compatibility path (§12).
- After code changes: `bun run check-types` from the repo root, full output, zero errors before a task is done.
- Tests run from the package root: `bun x vitest --run test/<file>` (`packages/cli`, `packages/ai`, `packages/agent`, `packages/app-server-protocol`).
- Each task adds its protocol pieces to the examples in `packages/app-server-protocol/test/protocol.test.ts` (one valid example per message; the coverage test fails without one) and regenerates `packages/cli/docs/app-server.schema.json` with `cd packages/app-server-protocol && bun run generate:schema`.
- Commits only when the user has authorized committing for this run (AGENTS.md). Otherwise finish each task at passing tests and a clean type check, and list the files it changed. Commit format `{feat,fix,docs,refactor,chore}(<scope>): <message>`, scope `cli` (protocol, `ai` and `agent` changes ship with the CLI task that needs them; AGENTS.md has no `app-server-protocol` scope); no `Co-Authored-By` trailer; no mention of other products.
- Stage explicit paths only; never `git add -A` or `git add .`. `git status` before each commit.

## Review Focus

These are the inputs most likely to hurt a user if a task gets them wrong. Each has tests in the task named, and the cases marked "probed" were run against the exact code in the task before the plan was finalised.

1. Withdrawing queued input in the window after the loop drained it and before it was delivered (a compaction can make that window long), for steers and for follow-ups: `removed: true` must mean it is never sent, and a request made only for withdrawn input must not happen, while tool-result replies and explicit continuations still do (Task 5).
2. A shell command that chains, redirects, quotes, expands, or runs other code through a wrapper, an interpreter, a flag before the subcommand, an executable path, a differently cased PowerShell name, or a nested runner whose target is itself a dispatcher (`uv run npm`, `npx npm`, `uv run git`), or a program on no list whose subcommands differ (`wsl`, `pip install` against `pip uninstall`, `poetry install` against `poetry run`): never offered a prefix that covers more than itself, never matched by one, in either shell (Task 7, probed).
3. Two writers of one settings file, including when the file does not exist yet and when the writers are different managers in the same process: a stale `expectedVersion` writes nothing and answers `configConflict`; a write is never overwritten by a setter queued before it; `config/read` never pairs old settings with a new version (Task 8).
4. Deleting a thread that is running, not archived, starts running or is unarchived while the delete looks up its file, is being resumed, or is held by another process: every refusal leaves the thread loaded and subscribed and its file untouched (Task 10).
5. A listing index that is corrupt in ways valid JSON allows (unknown or oversized fields, bad dates, long titles), larger than its budget, unwritable, or out of date; forks whose parents have misleading, renamed or archived names: the listing stays right and bounded, and a warm listing opens no transcript (Task 11, schema probed).

---

### Task 0: Test harness prerequisites

Two things every later task's tests need, done first so no task inherits a broken harness.

1. `startServer().connect()` installs only `threads.handlers()` (`harness.ts:68`). Production composes `threads.handlers()`, `accountHandlers(ctx)` and `modelHandlers(ctx)` through `appServerHandlers` (`entry.ts:24-26`), so today `model/list` and `config/read` answer `methodNotFound` in tests. Tasks 6 and 8 test those methods.
2. Several tests need a turn that is provably running for as long as the test wants. Streaming speed (`tokensPerSecond`) is a timing assumption; the Global Constraints forbid it for races. A tool that blocks until the test releases it is a gate.

**Files:**
- Modify: `packages/cli/test/app-server/harness.ts`
- Create: `packages/cli/test/app-server/fixtures/held-turn-extension.ts`
- Test: `packages/cli/test/app-server/harness.test.ts` (new)

**Interfaces:**
- Produces: `connect(mode?, options?)` serving the production handler set; `createHeldTurn(): HeldTurn` with `extension`, `entered: Promise<void>`, `release(): void`, used as `startServer({ extraExtensions: [{ name: "held-turn", factory: held.extension }] })` and a faux reply `fauxToolCall("hold", {})`.

- [ ] **Step 1: Write the failing test**

```ts
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

test("the harness serves model and config methods like production", async () => {
	const { connect } = await startServer();
	const a = await connect();
	expect((await a.client.request("model/list", {})).models.some((m) => m.id === "faux-1")).toBe(true);
	expect(await a.client.request("config/read", {})).toHaveProperty("settings");
});

test("a held turn stays running until released", async () => {
	const held = createHeldTurn();
	const { cwd, faux, threads, connect } = await startServer({
		extraExtensions: [{ name: "held-turn", factory: held.extension }],
	});
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	try {
		await held.entered;
		expect(threads.get(thread.id).session.isStreaming).toBe(true);
	} finally {
		held.release();
	}
	await a.waitFor("turn/completed");
});

test("a held turn that is never released does not block cleanup: unloading aborts it", async () => {
	const held = createHeldTurn();
	const { cwd, faux, threads, connect } = await startServer({
		extraExtensions: [{ name: "held-turn", factory: held.extension }],
	});
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" })]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	await held.entered;
	await threads.unload(thread.id); // resolves only because the tool honoured the abort
	expect(threads.loadedCount()).toBe(0);
});
```

Run: `cd packages/cli && bun x vitest --run test/app-server/harness.test.ts`
Expected: FAIL — `model/list` answers `methodNotFound`; the fixture does not exist.

- [ ] **Step 2: Compose production handlers in the harness**

In `harness.ts`, import `appServerHandlers` from `../../src/app-server/entry.ts` and pass `handlers: appServerHandlers(ctx, threads)` to `createInProcessClient` instead of `threads.handlers()`. The context already uses an `InMemoryCredentialStore` and the faux model, so account and model handlers touch nothing real. If importing `entry.ts` pulls in process-level side effects at import time, move `appServerHandlers` into its own module `packages/cli/src/app-server/handlers.ts` and import it from both `entry.ts` and the harness.

- [ ] **Step 3: The held-turn fixture**

```ts
import { Type } from "typebox";
import type { ExtensionAPI } from "../../../src/index.ts";

export interface HeldTurn {
	extension: (knightcode: ExtensionAPI) => void;
	/** Resolves when the `hold` tool started: the turn is provably running. */
	entered: Promise<void>;
	release(): void;
}

/** A tool `hold` that blocks until the test releases it, so a turn runs for exactly as long as a test needs. */
export function createHeldTurn(): HeldTurn {
	let release!: () => void;
	let entered!: () => void;
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	const enteredPromise = new Promise<void>((resolve) => {
		entered = resolve;
	});
	return {
		extension: (knightcode) => {
			knightcode.registerTool({
				name: "hold",
				label: "Hold",
				description: "Blocks until the test releases it.",
				parameters: Type.Object({}),
				execute: async (_toolCallId, _params, signal) => {
					entered();
					// Honour cancellation: a test that fails before release() must not leave cleanup waiting forever.
					const aborted = new Promise<void>((resolve) => {
						if (signal?.aborted) resolve();
						signal?.addEventListener("abort", () => resolve(), { once: true });
					});
					await Promise.race([released, aborted]);
					return { content: [{ type: "text", text: signal?.aborted ? "aborted" : "released" }], details: {} };
				},
			});
		},
		entered: enteredPromise,
		release,
	};
}
```

The harness's default connection mode is `tui`, whose default approval mode is `fullAccess`, so `hold` runs without an approval request. Tests that use the fixture also call `held.release()` in a `finally`, so an assertion failure between `held.entered` and the release still lets the turn finish; together with the abort handling above, `cleanupServers()` (which unloads every thread, aborting its run) cannot hang on a held tool. Tests that use `approvalMode: "ask"` answer the request for `hold` or start the thread in `fullAccess`.

- [ ] **Step 4: Run, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/harness.test.ts test/app-server/`
Run: `bun run check-types`
Expected: PASS.

```bash
git add packages/cli/test/app-server/harness.ts packages/cli/test/app-server/fixtures/held-turn-extension.ts packages/cli/test/app-server/harness.test.ts
git commit -m "chore(cli): serve production handlers in the app server harness and add a held-turn fixture"
```

(Add `packages/cli/src/app-server/handlers.ts` and `entry.ts` to the staged files if Step 2 moved `appServerHandlers`.)

---

### Task 1: Protocol 2 handshake, diagnostics and warnings

**Files:**
- Modify: `packages/app-server-protocol/src/protocol.ts`
- Modify: `packages/app-server-protocol/test/protocol.test.ts`
- Modify: `packages/cli/src/app-server/server.ts`
- Modify: `packages/cli/src/app-server/client.ts` (sends protocol 2, passes opt-outs)
- Modify: `packages/cli/src/app-server/threads.ts` (`server/diagnostics` handler)
- Modify (generated): `packages/cli/docs/app-server.schema.json`
- Test: `packages/cli/test/app-server/server.test.ts`

**Interfaces:**
- Produces: `PROTOCOL_VERSION = 2`; `InitializeParams.capabilities.optOutNotifications?: string[]`; `InitializeResult.platform: {os, arch, homeDir}`; error codes `turnMismatch`, `configConflict`, `threadNotArchived`; notification `warning: {message, threadId?, source, path?, line?, column?}`; request `server/diagnostics`; `ThreadManager.diagnostics(): ResultOf<"server/diagnostics">`; `AppServerClient.initialize(options?: {name?: string; optOutNotifications?: string[]})` (today it takes `name = "test"`; no caller passes a name, `rg -n "\.initialize\(\"" packages/cli` is empty).

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/test/app-server/server.test.ts`, importing `AppServer` from `../../src/app-server/server.ts`, `createInProcessPair` from `../../src/app-server/in-process.ts` (already exported, `in-process.ts:90`), `homedir` from `node:os`, `vi` from `vitest`, and `fauxAssistantMessage`, `fauxText` from `@knightcode/ai`:

```ts
test("protocol 1 is refused with versionMismatch (§4.6)", async () => {
	const { threads } = await startServer();
	const pair = createInProcessPair();
	const server = new AppServer({ transport: pair.server, mode: "tui", version: "0", handlers: threads.handlers() });
	const answers: unknown[] = [];
	pair.client.onMessage((message) => answers.push(message));
	pair.client.send({
		id: 1,
		method: "initialize",
		params: { clientInfo: { name: "old", version: "1" }, protocolVersion: 1, capabilities: {} },
	});
	await vi.waitFor(() => expect(answers).toHaveLength(1));
	expect((answers[0] as { error: { code: string } }).error.code).toBe("versionMismatch");
	server.close("abort");
});

test("initialize reports the platform, and an opted-out notification never arrives (§4.1)", async () => {
	const { cwd, faux, connect } = await startServer();
	const quiet = await connect("tui", { optOutNotifications: ["item/agentMessage/delta", "no/such/method"] });
	const loud = await connect();
	expect(quiet.initializeResult.platform.os).toBe(process.platform);
	expect(quiet.initializeResult.platform.homeDir).toBe(homedir());
	const { thread } = await quiet.client.request("thread/start", { cwd });
	await loud.client.request("thread/resume", { threadId: thread.id });
	faux.setResponses([fauxAssistantMessage([fauxText("streamed reply with several words in it")])]);
	await quiet.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await quiet.waitFor("turn/completed");
	await loud.waitFor("turn/completed");
	expect(quiet.notifications.some((n) => n.method === "item/agentMessage/delta")).toBe(false);
	expect(loud.notifications.some((n) => n.method === "item/agentMessage/delta")).toBe(true);
});

test("server/diagnostics reports loaded threads and memory (§4.4)", async () => {
	const { cwd, connect } = await startServer();
	const a = await connect();
	await a.client.request("thread/start", { cwd });
	const diagnostics = await a.client.request("server/diagnostics", {});
	expect(diagnostics.loadedThreads).toBe(1);
	expect(diagnostics.rssBytes).toBeGreaterThan(0);
	expect(diagnostics.uptimeMs).toBeGreaterThanOrEqual(0);
});
```

In `harness.ts`, give `connect` a second parameter `options?: { optOutNotifications?: string[] }` passed to `client.initialize(options)`, and keep the initialize result on the returned `TestClient` as `initializeResult: ResultOf<"initialize">`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/cli && bun x vitest --run test/app-server/server.test.ts`
Expected: FAIL — protocol 1 is accepted; `platform` is undefined; `server/diagnostics` answers `methodNotFound`.

- [ ] **Step 3: Change the schemas**

In `protocol.ts`:

```ts
export const PROTOCOL_VERSION = 2;

export const ErrorCode = Type.Union([
	// ...the existing literals, which already include shuttingDown and internal (protocol.ts:42-43)...
	Type.Literal("turnMismatch"),
	Type.Literal("configConflict"),
	Type.Literal("threadNotArchived"),
]);

export const Platform = Obj({
	os: Type.Union([Type.Literal("win32"), Type.Literal("darwin"), Type.Literal("linux")]),
	arch: Str,
	homeDir: Str,
});
```

`initialize`:

```ts
initialize: {
	params: Obj({
		clientInfo: Obj({ name: Str, version: Str }),
		protocolVersion: Num,
		capabilities: Obj({
			localHandles: Type.Optional(Bool),
			optOutNotifications: Type.Optional(Type.Array(Str, { maxItems: 256 })),
		}),
	}),
	result: Obj({
		serverInfo: Obj({ name: Type.Literal("knightcode"), version: Str }),
		protocolVersion: Num,
		platform: Platform,
	}),
},
"server/diagnostics": {
	params: Empty,
	result: Obj({
		rssBytes: Num,
		heapBytes: Num,
		loadedThreads: Num,
		loadingThreads: Num,
		payloadFiles: Num,
		payloadBytes: Num,
		inactiveFactories: Num,
		uptimeMs: Num,
	}),
},
```

In `ServerNotifications`, beside `error`:

```ts
warning: Obj({
	message: Str,
	threadId: Type.Optional(Str),
	source: Type.Union([
		Type.Literal("settings"),
		Type.Literal("extension"),
		Type.Literal("trust"),
		Type.Literal("server"),
	]),
	path: Type.Optional(Str),
	line: Type.Optional(Num),
	column: Type.Optional(Num),
}),
```

Update `protocol.test.ts`: the `initialize` example params use `protocolVersion: 2` and `capabilities: { optOutNotifications: ["item/reasoning/delta"] }`; the result example adds `platform: { os: "linux", arch: "x64", homeDir: "/home/u" }`; add examples for `server/diagnostics` (params `{}`, a result with every field) and the `warning` notification (`{ message: "bad settings", source: "settings", path: "/p/settings.json", line: 3, column: 5 }`).

- [ ] **Step 4: Implement in the server**

In `server.ts`, add a field and use it in `notify` and `initialize`:

```ts
import { arch, homedir } from "node:os";

private optedOut: ReadonlySet<string> = new Set();

notify<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void {
	if (this.state === "ready" && !this.optedOut.has(method)) this.transport.send({ method, params });
}

private initialize(params: ParamsOf<"initialize">): ResultOf<"initialize"> {
	// ...existing state and version checks...
	this.optedOut = new Set(params.capabilities.optOutNotifications ?? []);
	this.state = "initializing";
	return {
		serverInfo: { name: "knightcode", version: this.options.version },
		protocolVersion: PROTOCOL_VERSION,
		platform: { os: process.platform as "win32" | "darwin" | "linux", arch: arch(), homeDir: homedir() },
	};
}
```

Unknown names are simply never matched, which is the "ignored" rule of §4.1. Responses and server requests are not notifications and are never filtered.

In `client.ts`:

```ts
async initialize(options: { name?: string; optOutNotifications?: string[] } = {}): Promise<ResultOf<"initialize">> {
	const result = await this.request("initialize", {
		clientInfo: { name: options.name ?? "test", version: "0" },
		protocolVersion: PROTOCOL_VERSION,
		capabilities: options.optOutNotifications ? { optOutNotifications: options.optOutNotifications } : {},
	});
	this.notify("initialized", {});
	return result;
}
```

(`localHandles` is Phase D's; no client declares it yet.)

In `threads.ts`, add to `ThreadManager`:

```ts
private readonly startedAt = Date.now();

diagnostics(): ResultOf<"server/diagnostics"> {
	const memory = process.memoryUsage();
	const payloads = this.payloads.getStats();
	return {
		rssBytes: memory.rss,
		heapBytes: memory.heapUsed,
		loadedThreads: this.threads.size,
		loadingThreads: this.loading.size,
		payloadFiles: payloads.payloads,
		payloadBytes: payloads.bytes,
		inactiveFactories: getExtensionCacheStats().inactive,
		uptimeMs: Date.now() - this.startedAt,
	};
}
```

and the handler `"server/diagnostics": async () => this.diagnostics()`. `getExtensionCacheStats` already exists (`core/extensions/loader.ts:174`). `PayloadStore.getStats()` already returns `{ payloads, bytes, reading }` (`payloads.ts:313`); no new method is needed.

- [ ] **Step 5: Run the tests and the type check**

Run: `cd packages/cli && bun x vitest --run test/app-server/server.test.ts test/app-server/transport.test.ts test/app-server/stdio.test.ts`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS. Any other test that sent `protocolVersion: 1` by hand is updated to `PROTOCOL_VERSION` from the package, never to a literal.

- [ ] **Step 6: Commit** (if authorized)

```bash
git add packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/src/app-server/server.ts packages/cli/src/app-server/client.ts packages/cli/src/app-server/threads.ts packages/cli/docs/app-server.schema.json packages/cli/test/app-server/server.test.ts packages/cli/test/app-server/harness.ts
git commit -m "feat(cli): protocol 2 handshake with notification opt-out, platform and diagnostics"
```

---

### Task 2: Thread status with `waitingOn` and `systemError`, creation time, fork origin

**Files:**
- Modify: `packages/app-server-protocol/src/protocol.ts`, `test/protocol.test.ts`
- Modify: `packages/cli/src/app-server/loaded-thread.ts`, `approvals.ts`, `item-mapper.ts`, `threads.ts`
- Test: `packages/cli/test/app-server/thread-status.test.ts` (new), `review-regressions.test.ts`

**Interfaces:**
- Consumes: Task 1's schemas.
- Produces: `ThreadStatus` = `{type:"notLoaded"} | {type:"idle"} | {type:"active", waitingOn: ("approval"|"dialog")[]} | {type:"systemError", message: string}`; `Thread` and `ThreadSummary` gain `createdAt: string` and `forkedFromId?: string`; `LoadedThread.status(): ThreadStatus`; `LoadedThread.broadcastStatus(): void`; `ThreadManager.systemErrors: Map<string, string>`.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/app-server/thread-status.test.ts`:

```ts
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

type Status = { type: string; waitingOn?: string[]; message?: string };
const statusOf = (params: Record<string, unknown>) => params.status as Status;

test("an open approval shows as waitingOn on a connection that is not subscribed (§4.2)", async () => {
	const { cwd, faux, connect } = await startServer();
	const asker = await connect("desktop");
	const sidebar = await connect("desktop");
	asker.client.onRequest("item/toolCall/requestApproval", async () => {
		await sidebar.waitFor("thread/status/changed", (p) => (statusOf(p).waitingOn ?? []).includes("approval"));
		return { decision: "accept" };
	});
	const { thread } = await asker.client.request("thread/start", { cwd, approvalMode: "ask" });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await asker.client.request("turn/start", { threadId: thread.id, text: "run it" });
	await asker.waitFor("turn/completed");
	const statuses = sidebar.notifications
		.filter((n) => n.method === "thread/status/changed" && n.params.threadId === thread.id)
		.map((n) => statusOf(n.params));
	expect(statuses).toContainEqual({ type: "active", waitingOn: ["approval"] });
	// After the decision the thread is still active but no longer waiting, then idle.
	const afterWaiting = statuses.slice(statuses.findIndex((s) => (s.waitingOn ?? []).length > 0) + 1);
	expect(afterWaiting).toContainEqual({ type: "active", waitingOn: [] });
	expect(statuses.at(-1)).toEqual({ type: "idle" });
});

test("a fork's origin comes from the parent's header, not from a UUID-shaped file name", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	// A saved parent whose file name carries a different, misleading UUID, as an imported transcript can.
	const manager = SessionManager.create(cwd, sessionDir);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "parent" }], timestamp: 1 });
	const parentId = manager.getSessionId();
	const original = manager.getSessionFile()!;
	manager.close();
	const misleading = join(dirname(original), `2026-01-01T00-00-00-000Z_${randomUUID()}.jsonl`);
	renameSync(original, misleading);
	const a = await connect();
	const { thread: fork } = await a.client.request("thread/fork", { threadId: parentId });
	expect(fork.forkedFromId).toBe(parentId);
	const listed = await a.client.request("thread/list", { cwd });
	expect(listed.threads.find((t) => t.id === fork.id)?.forkedFromId).toBe(parentId);
	// Archiving the parent moves it into archived/; the fork still names it.
	await a.client.request("thread/archive", { threadId: parentId });
	const relisted = await a.client.request("thread/list", { cwd });
	expect(relisted.threads.find((t) => t.id === fork.id)?.forkedFromId).toBe(parentId);
});

test("a new thread reports createdAt, and a fork names its origin (§4.2)", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	expect(Number.isNaN(Date.parse(thread.createdAt))).toBe(false);
	faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	const { thread: fork } = await a.client.request("thread/fork", { threadId: thread.id });
	expect(fork.forkedFromId).toBe(thread.id);
	const listed = await a.client.request("thread/list", { cwd });
	expect(listed.threads.find((t) => t.id === fork.id)?.forkedFromId).toBe(thread.id);
});
```

Add to the lock-loss test that already exists in `review-regressions.test.ts` (the one asserting the `error` notification "Another KnightCode process took this thread's session file") the assertions:

```ts
await a.waitFor("thread/status/changed", (p) => statusOf(p).type === "systemError" && p.threadId === id);
const listed = await a.client.request("thread/list", {});
expect(listed.threads.find((t) => t.id === id)?.status.type).toBe("systemError");
```

Create a second connection `sidebar` before the lock loss; never resume or start the thread on it. Assert it
receives `systemError` too. After the other holder releases the file, pin recovery on that unsubscribed connection:

```ts
const beforeRecovery = sidebar.notifications.length;
await a.client.request("thread/resume", { threadId: id });
await vi.waitFor(() =>
	expect(
		sidebar.notifications.slice(beforeRecovery).some(
			(n) => n.method === "thread/status/changed" && n.params.threadId === id && statusOf(n.params).type === "idle",
		),
	).toBe(true),
);
const recovered = (await sidebar.client.request("thread/list", {})).threads.find((t) => t.id === id);
expect(recovered?.status).toEqual({ type: "idle" });
```

Also gate a failing reload and assert it emits no recovery status and keeps the recorded `systemError`. Import
`vi` and define `statusOf` in `review-regressions.test.ts` as needed; the notification assertion must inspect only
messages after `beforeRecovery`, not an earlier idle status.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/cli && bun x vitest --run test/app-server/thread-status.test.ts test/app-server/review-regressions.test.ts`
Expected: FAIL — `status` is a string; `createdAt` is undefined; recovery is not broadcast to the sidebar.

- [ ] **Step 3: Change the schemas**

```ts
export const ThreadStatus = Type.Union([
	Obj({ type: Type.Literal("notLoaded") }),
	Obj({ type: Type.Literal("idle") }),
	Obj({
		type: Type.Literal("active"),
		waitingOn: Type.Array(Type.Union([Type.Literal("approval"), Type.Literal("dialog")])),
	}),
	Obj({ type: Type.Literal("systemError"), message: Str }),
]);
export type ThreadStatus = Static<typeof ThreadStatus>;
```

Add `createdAt: Str` and `forkedFromId: Type.Optional(Str)` to both `ThreadSummary` and `Thread`. Update the `thread`, `summary` and `thread/status/changed` examples in `protocol.test.ts`.

- [ ] **Step 4: Compute status in one place**

In `loaded-thread.ts`:

```ts
/** Approval requests open on this thread, each counted once however many subscribers it is tried on. */
readonly openRequests = new Set<object>();

/** Kinds of server request open on this thread now; Phase C adds "dialog" for ui/dialog. */
waitingOn(): ("approval" | "dialog")[] {
	return this.openRequests.size > 0 ? ["approval"] : [];
}

status(): ThreadStatus {
	return this.session.isIdle && !this.session.isSettling
		? { type: "idle" }
		: { type: "active", waitingOn: this.waitingOn() };
}

/** Every change of status, including waitingOn, is a sidebar notification (§4.3). */
broadcastStatus(): void {
	this.broadcast("thread/status/changed", { threadId: this.id, status: this.status() });
}
```

`LoadedThread` receives the context's `broadcast` through its constructor (add a constructor parameter after `payloads`; `threads.ts` passes `this.ctx.broadcast`). It also gets `readonly forkedFromId: string | undefined`, computed once in `load()` with `parentIdOf(header.parentSession)`, so `toThread()` (called for many notifications) never touches the disk. `toThread()` uses `status: this.status()`, `createdAt: header.timestamp`, and `forkedFromId: this.forkedFromId`.

Add to `session-files.ts`:

```ts
/**
 * The session id a fork's parent path refers to, read from that file's header: never inferred from the file
 * name, since an imported or renamed transcript can carry any name. The header names the parent by path, and
 * archiving moves a file between a directory and its `archived/` subdirectory without renaming it, so both
 * places are tried. Undefined when the parent is gone.
 */
export function parentIdOf(path: string | undefined, onRead?: (path: string) => void): string | undefined {
	if (!path) return undefined;
	const dir = dirname(path);
	const name = basename(path);
	const candidates = isArchivedPath(path) ? [path, join(dirname(dir), name)] : [path, join(dir, ARCHIVE_DIR, name)];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		onRead?.(candidate);
		return readSessionHeaderForDiscovery(candidate)?.id;
	}
	return undefined;
}
```

`onRead` lets the listing count these header reads as transcript opens (Task 11), so a warm listing can prove it opened nothing.

In `item-mapper.ts`, replace the three literal status broadcasts:
- `agent_start`: `this.broadcast("thread/status/changed", { threadId, status: { type: "active", waitingOn: this.thread.waitingOn() } })`.
- `compaction_start` outside a turn: same as above.
- `compaction_end` outside a turn and `settled()`: `{ type: "idle" }`.

In `approvals.ts`, the request counts as waiting from its first attempt until `askApproval` returns, not per attempt, so moving it to the next subscriber (the `continue` path) never flickers `waitingOn` to empty. `LoadedThread` gets `readonly openRequests = new Set<object>()`, `waitingOn()` reads `this.openRequests.size > 0` instead of `asks`, and `askApproval` wraps its loop:

```ts
export async function askApproval(
	thread: LoadedThread,
	params: ServerRequestParams<"item/toolCall/requestApproval">,
	signal: AbortSignal,
): Promise<ApprovalDecision> { // Task 7 changes this to ApprovalResult
	const token = {};
	thread.openRequests.add(token);
	if (thread.openRequests.size === 1) thread.broadcastStatus();
	try {
		return await askEachSubscriber(thread, params, signal); // the existing for (;;) loop, unchanged
	} finally {
		thread.openRequests.delete(token);
		if (thread.openRequests.size === 0) thread.broadcastStatus();
	}
}
```

Rename the existing function body to `askEachSubscriber` (module-private).

In `threads.ts`:
- `readonly systemErrors = new Map<string, string>()`.
- `afterSettle`'s lock-lost branch sets `this.systemErrors.set(thread.id, message)` before `unload`, and the `unload` that follows broadcasts `{ type: "systemError", message }` instead of `notLoaded` when the id is in the map.
- At successful `load()` publication, after the thread is ready and installed in the ready map, synchronously call `this.systemErrors.delete(thread.id)` and, only if it returned `true`, `thread.broadcastStatus()`. No await separates clearing the error from publishing the recovered status. This is a sidebar broadcast to every initialized connection, including connections not subscribed to the thread. A failed load never clears the error or broadcasts recovery.
- `list()` maps each summary's `status` as: live thread → `live.status()`; `systemErrors.get(id)` → `{ type: "systemError", message }`; otherwise `{ type: "notLoaded" }`. It also fills `createdAt: info.created.toISOString()` and `forkedFromId: parentIdOf(info.parentSessionPath)`. That reads each forked thread's parent header on every listing; Task 11 caches the id in the listing index so a warm listing reads none.
- `read()` of an unloaded thread does the same from its header.
- Every other `status: "notLoaded"` broadcast becomes `{ type: "notLoaded" }`.

- [ ] **Step 5: Run the tests and the type check**

Run: `cd packages/cli && bun x vitest --run test/app-server/`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS. Existing tests that compared `status` to a string compare `status.type`.

- [ ] **Step 6: Commit** (if authorized)

```bash
git add packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/src/app-server/session-files.ts packages/cli/src/app-server/loaded-thread.ts packages/cli/src/app-server/approvals.ts packages/cli/src/app-server/item-mapper.ts packages/cli/src/app-server/threads.ts packages/cli/docs/app-server.schema.json packages/cli/test/app-server/thread-status.test.ts packages/cli/test/app-server/review-regressions.test.ts
git commit -m "feat(cli): thread status shows waiting on approval and lost-lock errors"
```

---

### Task 3: Turn timing and error kind; item timestamps

**Files:**
- Modify: `packages/ai/src/types.ts` (`AssistantMessage.errorSource`), `packages/ai/src/utils/retry.ts`, `packages/ai/src/index.ts` (export)
- Test: `packages/ai/test/retry.test.ts`
- Modify: `packages/agent/src/agent-loop.ts` (host-hook exception boundary), `packages/agent/src/agent.ts` (failure provenance)
- Test: `packages/agent/test/agent.test.ts`
- Modify: `packages/cli/src/extensions/turn-marker.ts`
- Modify: `packages/cli/src/core/session-manager.ts` (`appendCustomMessageEntry` timestamp), `packages/cli/src/core/agent-session.ts` (its callers)
- Modify: `packages/app-server-protocol/src/protocol.ts`, `test/protocol.test.ts`
- Modify: `packages/cli/src/app-server/transcript.ts`, `item-mapper.ts`, `payloads.ts`
- Test: `packages/cli/test/app-server/turns.test.ts`, `transcript.test.ts`, `packages/cli/test/suite/turn-marker.test.ts`
- Modify: `apps/desktop/docs/desktop-app/architecture.md` §§4.2–4.6, `desktop-shell.md` §§7.1, 9.2, 9.12 (sidebar outcome contract)

**Interfaces:**
- Produces (ai): `AssistantMessage.errorSource?: "host"`; `type AssistantErrorKind = "auth" | "rateLimit" | "contextOverflow" | "network" | "provider"`; `classifyAssistantError(message: AssistantMessage, contextWindow?: number): AssistantErrorKind | "other" | undefined` (undefined when the message is not an error; `other` for a host failure).
- Produces (agent, module-internal API): `HostHookError extends Error` with `constructor(cause: unknown)`, and `callHostHook<T>(run: () => T | Promise<T>): Promise<T>` in `agent-loop.ts`; `agent.ts` imports the error class directly, not through the package barrel.
- Produces (turn-marker): `TurnEnd = { status; error?: { message: string; kind: TurnErrorKind } }`, `TurnErrorKind = AssistantErrorKind | "other"`; `parseTurnEnd` reads both the new object and a protocol 1 string error (as `kind: "other"`).
- Produces (protocol): `TurnError`, `Turn.startedAt`, `Turn.completedAt?`, `TurnSummary` likewise, `Turn.error?: TurnError`; every `Item` variant gains `startedAt?: number`, `completedAt?: number`.
- Produces (transcript): `itemTimes(entry, role)` helpers shared by both paths (below).
- Produces (protocol): sidebar notification `thread/turn/completed { turn: TurnSummary }`, sent to every initialized connection. It contains no items or payload reference; the existing subscriber-only `turn/completed` is unchanged. Initialization uses the newest page of the existing read-only `thread/read`, not subscriptions or a new persisted outcome index.

- [ ] **Step 1: Write the failing classifier test**

Append to `packages/ai/test/retry.test.ts`:

```ts
import { classifyAssistantError } from "../src/utils/retry.ts";

const failed = (errorMessage: string) =>
	({ role: "assistant", stopReason: "error", errorMessage, content: [], usage: emptyUsage(), timestamp: 0 }) as AssistantMessage;

test("classifyAssistantError maps provider failures to a kind clients can act on", () => {
	expect(classifyAssistantError(failed("429 Too Many Requests"))).toBe("rateLimit");
	expect(classifyAssistantError(failed("insufficient_quota: billing"))).toBe("rateLimit");
	expect(classifyAssistantError(failed("401 Unauthorized: invalid x-api-key"))).toBe("auth");
	expect(classifyAssistantError(failed("OAuth token has expired"))).toBe("auth");
	for (const text of [
		"fetch failed: getaddrinfo ENOTFOUND api.example",
		"upstream connect error or disconnect/reset before headers",
		"Anthropic stream ended before message_stop",
		"http2 request did not get a response",
		"pending stream has been canceled",
	]) expect(classifyAssistantError(failed(text)), text).toBe("network");
	expect(classifyAssistantError({ ...failed("host hook failed"), errorSource: "host" })).toBe("other");
	// Provenance wins over text that would otherwise suggest a provider or network error.
	expect(classifyAssistantError({ ...failed("fetch failed"), errorSource: "host" })).toBe("other");
	expect(isRetryableAssistantError({ ...failed("fetch failed"), errorSource: "host" })).toBe(false);
	expect(classifyAssistantError(failed("prompt is too long: 210000 tokens > 200000 maximum"))).toBe("contextOverflow");
	expect(classifyAssistantError(failed("Invalid schema for function 'x'"))).toBe("provider");
	expect(classifyAssistantError({ ...failed("x"), stopReason: "stop" })).toBeUndefined();
});
```

Use the file's existing helper for an empty `Usage` if it has one; otherwise build `{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }` inline as `emptyUsage()`.

Run: `cd packages/ai && bun x vitest --run test/retry.test.ts`
Expected: FAIL — `classifyAssistantError` is not exported.

- [ ] **Step 2: Implement the classifier**

In `packages/ai/src/utils/retry.ts`, add the classifier after `isRetryableAssistantError`. Place the shared
`TRANSPORT_ERROR_PATTERNS` constant **before** `RETRYABLE_PROVIDER_ERROR_PATTERN`, which spreads it into its
existing provider-pattern list; it must be initialized before either regular expression is built. Keep the
`overflow.ts` import at the top of the file:

```ts
import { isContextOverflow } from "./overflow.ts";

export type AssistantErrorKind = "auth" | "rateLimit" | "contextOverflow" | "network" | "provider";

const RATE_LIMIT_PATTERN = buildProviderErrorPattern(["rate.?limit", "too many requests", "\\b429\\b", "quota"]);
const AUTH_PATTERN = buildProviderErrorPattern([
	"\\b40[13]\\b",
	"unauthori[sz]ed",
	"forbidden",
	"invalid.{0,24}(?:api.?key|token|credential|x-api-key)",
	"(?:missing|no).{0,12}api.?key",
	"authentication",
	"expired.{0,24}token",
	"token.{0,24}expired",
]);
// Extract the existing network/proxy/fetch, WebSocket and premature-stream-ending sections of
// RETRYABLE_PROVIDER_ERROR_PATTERN into this shared list, preserving every existing pattern and comment.
// Add connection reset / ECONNRESET; spread this list back into RETRYABLE_PROVIDER_ERROR_PATTERN too.
const TRANSPORT_ERROR_PATTERNS = [
	"network.?error",
	"connection.?(?:error|refused|lost|reset)",
	"other side closed",
	"fetch failed",
	"getaddrinfo",
	"ENOTFOUND",
	"EAI_AGAIN",
	"ECONNRESET",
	"upstream.?connect",
	"reset before headers",
	"socket hang up",
	"socket connection was closed",
	"timed? out",
	"timeout",
	"terminated",
	"websocket.?closed",
	"websocket.?error",
	"ended without",
	"stream ended before message_stop",
	"stream ended before a terminal response event",
	"http2 request did not get a response",
	"pending stream has been canceled",
] as const;
const NETWORK_PATTERN = buildProviderErrorPattern(TRANSPORT_ERROR_PATTERNS);

/**
 * What kind of failure an errored assistant message is, from the same message text the retry
 * classifier reads (messages carry no HTTP status). Order matters: an overflow often mentions tokens
 * and limits, and a quota error is not an authentication problem.
 */
export function classifyAssistantError(
	message: AssistantMessage,
	contextWindow?: number,
): AssistantErrorKind | "other" | undefined {
	if (message.stopReason !== "error") return undefined;
	if (message.errorSource === "host") return "other";
	const text = message.errorMessage ?? "";
	if (isContextOverflow(message, contextWindow)) return "contextOverflow";
	if (NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN.test(text) || RATE_LIMIT_PATTERN.test(text)) return "rateLimit";
	if (AUTH_PATTERN.test(text)) return "auth";
	if (NETWORK_PATTERN.test(text)) return "network";
	return "provider";
}
```

Check `overflow.ts` does not import `retry.ts` (no cycle). Export `classifyAssistantError` and `AssistantErrorKind` from `packages/ai/src/index.ts` beside `isRetryableAssistantError`. Keep provider load/status/retry-guidance patterns separate from `TRANSPORT_ERROR_PATTERNS`: a retryable 503 or "Provider returned error" is not automatically a network error. `isRetryableAssistantError` returns `false` for `errorSource === "host"` before matching text.

Add the optional `errorSource?: "host"` field to `AssistantMessage` in `packages/ai/src/types.ts`. Absence keeps
provider-text classification, including existing transcripts. Persist the field on the synthetic message rather
than guessing provenance from wording or storing it only in a live WeakMap.

In `agent-loop.ts`, implement `HostHookError` with the original message and `cause`, and
`callHostHook<T>(run: () => T | Promise<T>): Promise<T>` which wraps synchronous and asynchronous hook exceptions,
without double-wrapping a `HostHookError`. Use it at the calls to `prepareRequest`, `prepareNextTurn`, `finishTurn`,
`transformContext`, `convertToLlm` and `getApiKey`. Do not wrap `streamFunction`, its stream iteration or its
`result()` as host hooks: those failures retain provider/transport classification. Do not change abort handling
or the tool-result failure path. In `Agent.handleRunFailure()`, set `errorSource: "host"` only when the caught error
is a `HostHookError`; keep its original error text. No new error event or public exception framework is needed.

Test in `packages/agent/test/agent.test.ts`: a real `Agent` whose `prepareRequest` throws `new Error("host hook failed")`
emits and stores an errored assistant message with `errorSource === "host"` and that exact text. Cover an async
`prepareNextTurn` rejection and a `finishTurn` throw too. A thrown stream function error `"upstream connect error"`
must not carry the host marker. Run these tests failing before the agent changes, then passing after:
`cd packages/agent && bun x vitest --run test/agent.test.ts test/agent-loop.test.ts`.

Run: `cd packages/ai && bun x vitest --run test/retry.test.ts test/overflow.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing app-server tests**

Append to `packages/cli/test/app-server/turns.test.ts`:

```ts
test("turn and item times and the error kind agree live and read back (§4.2)", async () => {
	const { cwd, faux, agentDir, connect } = await startServer();
	// A 429 is retryable; with retries on, the turn would only fail after the default backoff.
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: false } }));
	const a = await connect();
	writeFileSync(join(cwd, "a.txt"), "one\n");
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("read", { path: "a.txt" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("read it")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "read a.txt" });
	const done = (await a.waitFor("turn/completed")).turn as { startedAt: number; completedAt: number };
	expect(done.completedAt).toBeGreaterThanOrEqual(done.startedAt);
	const [turn] = await a.readTurns(thread.id);
	expect(turn.startedAt).toBe(done.startedAt);
	expect(turn.completedAt).toBe(done.completedAt);
	const live = completedItems(a);
	for (const item of turn.items) {
		const seen = live.get(item.id) as LiveItem & { startedAt?: number; completedAt?: number };
		expect(seen.completedAt).toBe(item.completedAt);
		if (item.type === "toolCall") {
			expect(item.startedAt).toBeDefined();
			expect(item.completedAt!).toBeGreaterThanOrEqual(item.startedAt!);
			expect(seen.startedAt).toBe(item.startedAt);
		}
	}

	faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "429 Too Many Requests" })]);
	await a.client.request("turn/start", { threadId: thread.id, text: "again" });
	const failed = (await a.waitFor("turn/completed", (p) => (p.turn as { status: string }).status === "failed"))
		.turn as { error: { kind: string; message: string } };
	expect(failed.error.kind).toBe("rateLimit");
	const turns = await a.readTurns(thread.id);
	expect(turns.at(-1)!.error).toEqual(failed.error);
});
```

Add this actual host-hook regression to `turns.test.ts`; the mapper's thrown-error fallback alone cannot cover
it, because `Agent.handleRunFailure()` converts the exception to an assistant error message:

```ts
test.each(["host hook failed", "fetch failed"])("a host exception stays other live and read back: %s", async (message) => {
	const { cwd, threads, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	threads.get(thread.id).session.agent.prepareRequest = () => {
		throw new Error(message);
	};
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	const live = (await a.waitFor("turn/completed")).turn as { error: { message: string; kind: string } };
	expect(live.error).toEqual({ message, kind: "other" });
	expect((await a.readTurns(thread.id)).at(-1)!.error).toEqual(live.error);
});
```

Append to `packages/cli/test/suite/turn-marker.test.ts` (where the built-in is tested today): a run whose last assistant message failed with "401 Unauthorized" writes an end entry `{ status: "failed", error: { message: "401 Unauthorized", kind: "auth" } }`. Also assert a synthetic host failure writes `{ status: "failed", error: { message: "host hook failed", kind: "other" } }`.

Append to `transcript.test.ts` a read-back test: build entries by hand (a marker custom entry with timestamp `T0`, a user message with `timestamp: T1`, an assistant message with `timestamp: T2, durationMs: 500` and a tool call, a tool result with `timestamp: T3`, an end entry with `{ status: "completed" }` at `T4`) and assert `startedAt === Date.parse(T0 iso)`, `completedAt === T4`, the agent text item `startedAt === T2`, `completedAt === T2 + 500`, the call `startedAt === T2 + 500`, `completedAt === T3`, the user item `completedAt === T1` and no `startedAt`. Also assert a protocol 1 end entry `{ status: "failed", error: "boom" }` reads back `error: { message: "boom", kind: "other" }`, and an unmarked turn ending with `errorSource: "host"` reads `kind: "other"` even when its error text is `"fetch failed"`.

Run: `cd packages/cli && bun x vitest --run test/app-server/turns.test.ts test/app-server/transcript.test.ts`
Expected: FAIL — no times, `error` is a string.

- [ ] **Step 4: Change the schemas**

```ts
export const TurnErrorKind = Type.Union([
	Type.Literal("auth"),
	Type.Literal("rateLimit"),
	Type.Literal("contextOverflow"),
	Type.Literal("network"),
	Type.Literal("provider"),
	Type.Literal("other"),
]);
export const TurnError = Obj({ message: Str, kind: TurnErrorKind });
export type TurnError = Static<typeof TurnError>;
const Times = {
	startedAt: Type.Optional(Num),
	completedAt: Type.Optional(Num),
};
```

Spread `...Times` into every `Item` variant object. `Turn` gets `error: Type.Optional(TurnError)`, `startedAt: Num`, `completedAt: Type.Optional(Num)`. `TurnSummary` and `TurnReference` get `error: Type.Optional(Obj({ message: Type.String({ maxLength: 2000 }), kind: TurnErrorKind }))`, `startedAt: Num`, `completedAt: Type.Optional(Num)`. Update the `turn` and `item` examples. Add sidebar notification
`"thread/turn/completed": Obj({ turn: TurnSummary })` and an example with a failed turn's id, thread id, times
and typed error, without `items` or `payload`.

- [ ] **Step 5: Store the kind in the end entry**

In `turn-marker.ts`:

```ts
import { classifyAssistantError, type AssistantErrorKind } from "@knightcode/ai";

export type TurnErrorKind = AssistantErrorKind | "other";
export interface TurnEnd {
	status: "completed" | "interrupted" | "failed";
	error?: { message: string; kind: TurnErrorKind };
}

export function turnEndOf(aborted: boolean, branch: readonly SessionEntry[]): TurnEnd {
	if (aborted) return { status: "interrupted" };
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isTurnMarker(entry)) break;
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		if (entry.message.stopReason === "aborted") return { status: "interrupted" };
		if (entry.message.stopReason === "error") {
			return {
				status: "failed",
				error: {
					message: entry.message.errorMessage ?? "the turn failed",
					kind: classifyAssistantError(entry.message) ?? "provider",
				},
			};
		}
		return { status: "completed" };
	}
	return { status: "completed" };
}

const KINDS: ReadonlySet<string> = new Set(["auth", "rateLimit", "contextOverflow", "network", "provider", "other"]);

export function parseTurnEnd(data: unknown): TurnEnd | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const { status, error } = data as { status?: unknown; error?: unknown };
	if (status !== "completed" && status !== "interrupted" && status !== "failed") return undefined;
	// Protocol 1 end entries stored the message alone.
	if (typeof error === "string") return { status, error: { message: error, kind: "other" } };
	if (typeof error === "object" && error !== null) {
		const { message, kind } = error as { message?: unknown; kind?: unknown };
		if (typeof message === "string")
			return { status, error: { message, kind: typeof kind === "string" && KINDS.has(kind) ? (kind as TurnErrorKind) : "other" } };
	}
	return { status };
}
```

In `item-mapper.ts`'s `settled()`, the fallback for a thrown error becomes `{ status: "failed", error: { message, kind: "other" } }`. In `transcript.ts`, an unmarked legacy turn's `lastError` becomes `{ message: t.lastError, kind: classifyAssistantError(lastAssistant) ?? "provider" }` (keep the last assistant message in `Building` instead of only its stop reason and error text).

- [ ] **Step 6: Each time comes from one durable value, read the same way on both paths**

Every time a client sees must be the same number live and after `thread/read`, so each one is read from a value that exists before the live notification is sent and is what the file stores. The table is the contract; the code follows it.

| Time | Durable source | Live: available when | Read-back |
| --- | --- | --- | --- |
| Turn `startedAt` | the marker entry's `timestamp` | `agent_start`: the mapper reads the marker it found (`openMarkerOf`) or, in the fallback, the entry it just appended (`this.manager.getEntry(id)`) | marker entry |
| Turn `completedAt` | the end entry's `timestamp` | `settled()`: the end entry it found or appended (`turnEndEntryAt(branch)`) | end entry; absent when there is none |
| `userMessage` `completedAt` | `message.timestamp` (stored inside the message) | user `message_end` | the message |
| `agentMessage` / `reasoning` | `message.timestamp` and `message.durationMs` (stored inside the message) | assistant `message_end` | the message |
| top-level `toolCall` | `startedAt`: the assistant message's `timestamp + (durationMs ?? 0)`; `completedAt`: the tool result message's `timestamp` | assistant `message_end`; tool result `message_end` | the two messages |
| nested `toolCall` | none: nested calls are live only (§4.2) | `tool_execution_start` / `tool_execution_end`, `Date.now()` | never read back |
| `compaction` `completedAt` | the compaction entry's `timestamp` | `compaction_end`: the session appends the entry before emitting it (`agent-session.ts:3023` then `:3053`, and `:3363` then `:3396`); the mapper reads `getLatestCompactionEntry(branch)` | compaction entry |
| `extensionMessage` `completedAt` | `CustomMessage.timestamp` | custom `message_end` | the custom message entry's `timestamp`, which this step makes equal to the message's |

Two gaps in today's code, fixed here:

1. A custom message entry gets its own `new Date()` when appended (`session-manager.ts:1450`), a few milliseconds after the message's `timestamp`. `appendCustomMessageEntry` gains an optional last parameter `timestamp?: number`; when given, the entry's `timestamp` is `new Date(timestamp).toISOString()`. Every caller that persists a `CustomMessage` passes `message.timestamp`: `agent-session.ts:1220` (`event.message.timestamp`), `:2477` (`appMessage.timestamp`), and `:1018` (`draft.timestamp` if the draft type has one; read it, and leave the call unchanged if it does not, since that path does not reach the mapper as a `message_end`). Entries written before this change read back with their own time; no live notification exists for them to disagree with.
2. When the end entry cannot be written (lost lock), the live `turn/completed` has no durable completion time. It carries `completedAt: Date.now()`; read-back has no end entry, reads the turn as `interrupted` (§4.2) and has no `completedAt`. This is the one place live and read-back differ, as status already does; the test pins it.

Add to `transcript.ts`, used by both paths:

```ts
/** Unix ms of an entry's ISO timestamp. */
export const entryTime = (entry: SessionEntry): number => Date.parse(entry.timestamp);

/** An assistant message's request start and end; end is absent when the response duration is unknown. */
export function assistantTimes(message: AssistantMessage): { startedAt: number; completedAt?: number } {
	return message.durationMs === undefined
		? { startedAt: message.timestamp }
		: { startedAt: message.timestamp, completedAt: message.timestamp + message.durationMs };
}

/** A top-level tool call starts when its assistant message completed. */
export const callStartedAt = (message: AssistantMessage): number => message.timestamp + (message.durationMs ?? 0);
```

and to `turn-marker.ts`:

```ts
/** The end entry of the latest turn, if it has one. `turnEndAt` parses this entry's data. */
export function turnEndEntryAt(branch: readonly SessionEntry[]): SessionEntry | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isTurnMarker(entry)) return undefined;
		if (isTurnEnd(entry)) return entry;
	}
	return undefined;
}

export function turnEndAt(branch: readonly SessionEntry[]): TurnEnd | undefined {
	const entry = turnEndEntryAt(branch);
	return entry?.type === "custom" ? parseTurnEnd(entry.data) : undefined;
}
```

Read-back (`readTurns`): `open()` receives the marker entry and sets `startedAt: entryTime(marker)`; an unmarked (legacy) turn starts at its first user message's `timestamp`. The end entry sets `completedAt: entryTime(end)`; an unmarked turn that ended takes its last assistant message's `assistantTimes(m).completedAt ?? m.timestamp`. Items use the table's sources: user `completedAt: message.timestamp`; assistant blocks `...assistantTimes(message)`; calls `startedAt: callStartedAt(assistant)` and, from the result, `completedAt: result.timestamp`; compaction and custom messages `completedAt: entryTime(entry)`.

Live (`item-mapper.ts`): the same helpers on the same message objects at the events named in the table. In the `agent_start` fallback, keep the entry the mapper appends: `const written = this.manager.getEntry(this.manager.appendCustomEntry(TURN_MARKER_TYPE))` and take `startedAt` from it. A streaming text item's `item/started` may carry `startedAt: Date.now()` as a placeholder; its `item/completed` carries `assistantTimes(message)`, which is final and equals read-back. Nested calls take `startedAt`/`completedAt` from `Date.now()` at their execution events.

`payloads.ts` `summary()` copies `startedAt`, `completedAt`, and `error` with `message` passed through `preview(…, 2000)`.

Add these parity tests to `turns.test.ts` (each compares the last `item/completed` of every item, and `turn/completed`, with `readTurns`, using `expectReadBackMatches` extended to compare `startedAt` and `completedAt`):

```ts
test("an extension message keeps its time live and read back", async () => {
	const { cwd, faux, connect } = await startServer({
		extraExtensions: [
			{
				name: "note",
				factory: (k) => {
					k.on("agent_start", () => k.sendMessage({ customType: "note", content: "noted", display: true }));
				},
			},
		],
	});
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	await expectReadBackMatches(a, thread.id);
	const [turn] = await a.readTurns(thread.id);
	expect(turn.items.find((i) => i.type === "extensionMessage")?.completedAt).toBeTypeOf("number");
});

test("times match with the turn-marker built-in disabled", async () => {
	const { cwd, faux, connect } = await startServer({ disabledBuiltinExtensions: ["turn-marker"] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("one")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	const live = (await a.waitFor("turn/completed")).turn as { startedAt: number; completedAt: number };
	const [turn] = await a.readTurns(thread.id);
	expect([turn.startedAt, turn.completedAt]).toEqual([live.startedAt, live.completedAt]);
});

test("an idle compaction keeps its time live and read back", async () => {
	const { cwd, faux, threads, agentDir, connect } = await startServer();
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("one")]), fauxAssistantMessage([fauxText("summary")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	await a.client.request("thread/compact", { threadId: thread.id });
	const live = (await a.waitFor("item/completed", (p) => (p.item as { type: string }).type === "compaction")).item as {
		id: string;
		completedAt: number;
	};
	const entry = threads
		.get(thread.id)
		.session.sessionManager.getBranch()
		.findLast((e) => e.type === "compaction")!;
	expect(live.completedAt).toBe(Date.parse(entry.timestamp));
	const turns = await a.readTurns(thread.id);
	expect(turns.flatMap((t) => t.items).find((i) => i.id === live.id)?.completedAt).toBe(live.completedAt);
});

test("nested calls carry live times and are never read back", async () => {
	const held = createHeldTurn();
	const { cwd, faux, threads, connect } = await startServer({ extraExtensions: [{ name: "held-turn", factory: held.extension }] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {}, { id: "parent-1" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await held.entered;
	// Code mode reports nested calls through these two session events (§4.3); drive the thread's real mapper with them.
	const mapper = threads.get(thread.id).mapper;
	mapper.handle({ type: "tool_execution_start", toolCallId: "nested-1", toolName: "read", args: {}, parentToolCallId: "parent-1" });
	mapper.handle({
		type: "tool_execution_end",
		toolCallId: "nested-1",
		toolName: "read",
		result: { content: [{ type: "text", text: "ok" }] },
		isError: false,
	});
	held.release();
	await a.waitFor("turn/completed");
	const nested = a.notifications
		.filter((n) => n.method === "item/completed" && itemOf(n).id === "nested-1")
		.map((n) => n.params.item as { startedAt?: number; completedAt?: number });
	expect(nested).toHaveLength(1);
	expect(nested[0].completedAt!).toBeGreaterThanOrEqual(nested[0].startedAt!);
	const turns = await a.readTurns(thread.id);
	expect(turns.flatMap((t) => t.items).some((i) => i.id === "nested-1")).toBe(false);
});

test("a turn whose end entry cannot be written reads back interrupted without completedAt", async () => {
	const held = createHeldTurn();
	const { cwd, faux, threads, connect } = await startServer({ extraExtensions: [{ name: "held-turn", factory: held.extension }] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await held.entered;
	const file = threads.get(thread.id).file!;
	// Another holder takes the file mid-turn, as review-regressions.test.ts "idle ownership loss…" does.
	writeFileSync(`${file}.lock-owner`, "replacement-owner");
	held.release();
	const live = (await a.waitFor("turn/completed")).turn as { status: string; completedAt?: number };
	expect(live.completedAt).toBeTypeOf("number");
	await vi.waitFor(() => expect(threads.loadedCount()).toBe(0));
	const [turn] = await a.readTurns(thread.id);
	expect(turn.status).toBe("interrupted");
	expect(turn.completedAt).toBeUndefined();
});
```

The nested-call test drives the thread's real mapper with the two events code mode produces for a nested call; match their fields to `AgentSessionEvent`'s `tool_execution_start` / `tool_execution_end` members exactly (the mapper reads `parentToolCallId`, `result.content` and `isError`). The `sendMessage` call in the extension-message test is `ExtensionAPI.sendMessage`; check its parameter shape in `core/extensions/types.ts` before using it.

**Sidebar outcome slice, test first.** Add a parameterized `turns.test.ts` test for completed, failed and interrupted
turns. Connect `sidebar` before the run and never subscribe it. Assert:

```ts
const outcome = (
	await sidebar.waitFor("thread/turn/completed", (p) => (p.turn as { threadId: string }).threadId === thread.id)
).turn as { id: string; threadId: string; status: string; error?: unknown; startedAt: number; completedAt?: number };
expect(outcome.status).toBe(expectedStatus);
expect(outcome).not.toHaveProperty("items");
expect(outcome).not.toHaveProperty("payload");
expect(sidebar.notifications.some((n) => n.method === "turn/completed")).toBe(false);
expect(sidebar.notifications.some((n) => n.method.startsWith("item/"))).toBe(false);
const latest = (await sidebar.readTurns(thread.id)).at(-1)!;
expect(outcome).toEqual({
	id: latest.id,
	threadId: latest.threadId,
	status: latest.status,
	startedAt: latest.startedAt,
	...(latest.completedAt === undefined ? {} : { completedAt: latest.completedAt }),
	...(latest.error === undefined ? {} : { error: latest.error }),
});
```

Use the held-turn fixture for interruption, releasing it in `finally`, and disable retries for provider failures.
A fresh connection that joins after completion must obtain the same outcome from the newest `thread/read` page
without loading or subscribing; assert `loadedCount()` is unchanged and `thread/unsubscribe` still reports it was
not subscribed (until Task 10, use the thread's subscriber set). Also test that a long error is capped at 2,000
characters in the outcome summary, using the same `payloads.summary()` as subscriber notifications. Run these
cases failing before the broadcast change.

In `item-mapper.ts`'s `settled()`, once status, error and times are final, compute one
`const summary = this.thread.payloads.summary(turn)`, notify subscribers with `turn/completed`, and broadcast
`thread/turn/completed` with `{ turn: summary }` before the idle status broadcast. The sidebar summary never
contains items, a payload capability or raw transcript text. Other connections need no thread subscription.

Update the two specifications in this task, not a later desktop implementation:
- `architecture.md` §§4.3–4.6 lists `thread/turn/completed` as a sidebar notification and specifies newest-page
  `thread/read` as its read-back path. Keep `turn/completed` subscriber-only and retain the documented lost-end-entry
  exception to live/read-back parity. §4.2 states that durable host provenance classifies as `other`.
- `desktop-shell.md` §§7.1, 9.2 and 9.12 routes this summary to every window's sidebar slice. On startup/reconnect,
  fetch the newest `thread/read` page only for visible rows, with at most two reads in flight; never load or
  subscribe every sidebar thread. Reuse `TurnReference` summary fields without fetching its payload. During a
  row's read, retain its latest outcome notification and apply it after the read so an older snapshot cannot
  replace a newer completion. Hidden rows initialize on becoming visible. Read-back initializes the failed mark;
  unread compares the terminal id with `DesktopState.lastSeen[threadId]` (§7.3). An initial read-back with no saved
  last-seen id establishes a baseline, not an unread completion. A live completion while that thread is not being
  viewed still sets unread, including the first live event; viewing it records the id. An active/waiting mark takes
  precedence over its previous outcome; `systemError` remains separate. OS notifications fire on live outcomes
  only, never on startup reads.

This reuses the existing paged read and local desktop state; it adds no server-side unread state, persistent
outcome index, or transcript subscriptions for the sidebar.

- [ ] **Step 7: Run the tests and the type check**

Run: `cd packages/ai && bun x vitest --run test/retry.test.ts test/overflow.test.ts`
Run: `cd packages/agent && bun x vitest --run test/agent.test.ts test/agent-loop.test.ts`
Run: `cd packages/cli && bun x vitest --run test/app-server/ test/suite/turn-marker.test.ts`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS.

- [ ] **Step 8: Commit** (if authorized)

```bash
git add packages/ai/src/types.ts packages/ai/src/utils/retry.ts packages/ai/src/index.ts packages/ai/test/retry.test.ts packages/agent/src/agent-loop.ts packages/agent/src/agent.ts packages/agent/test/agent.test.ts apps/desktop/docs/desktop-app/architecture.md apps/desktop/docs/desktop-app/desktop-shell.md packages/cli/src/extensions/turn-marker.ts packages/cli/src/core/session-manager.ts packages/cli/src/core/agent-session.ts packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/src/app-server/transcript.ts packages/cli/src/app-server/item-mapper.ts packages/cli/src/app-server/payloads.ts packages/cli/docs/app-server.schema.json packages/cli/test/app-server/turns.test.ts packages/cli/test/app-server/transcript.test.ts packages/cli/test/suite/turn-marker.test.ts
git commit -m "feat(cli): turn and item timestamps and a typed turn error kind"
```

---

### Task 4: File change diffs, client message ids on prompts, images by path

`clientMessageId` must never be inferred from text. The text a client sent is not the text that becomes the message: input hooks transform it, skills and prompt templates expand it, image processing appends hints, a command can consume it, and two queued messages can have the same text and be delivered in a different order than they were sent. So the id is attached to the message object the session builds from that input, and the mapper asks the session for the id of the exact object it sees at `message_end`. User messages reach subscribers as the same objects the session built (the agent loop replaces only system messages, `agent-loop.ts:334-345`). The id lives in a `WeakMap`, so it is never persisted and dies with its message. This task covers `turn/start`; Task 5 applies the same mechanism to steers and follow-ups.

**Files:**
- Create: `packages/cli/src/app-server/image-input.ts`
- Modify: `packages/cli/src/core/agent-session.ts` (`PromptOptions.clientMessageId`, `clientMessageIdOf`)
- Modify: `packages/app-server-protocol/src/protocol.ts`, `test/protocol.test.ts`
- Modify: `packages/cli/src/app-server/transcript.ts`, `item-mapper.ts`, `threads.ts`
- Test: `packages/cli/test/app-server/image-input.test.ts` (new), `turns.test.ts`

**Interfaces:**
- Produces (session): `PromptOptions.clientMessageId?: string`; `AgentSession.clientMessageIdOf(message: AgentMessage): string | undefined`.
- Produces (protocol): `FileChange.diff?: string`; `ImageInput = ImageRef | { path: string }`; `turn/start`, `turn/steer`, `turn/followUp` take `images?: ImageInput[]` and `clientMessageId?: string` (1..128 chars); `userMessage.clientMessageId?: string` (live only).
- Produces (server): `readImageInput(input: ImageInput): Promise<ImageRef>`, every failure an `AppServerError("invalidParams")`; `readAtMost(file: PositionalReader, limit: number): Promise<Buffer>`; `fileChangesOf(tool, input, isError, details?)`.

- [ ] **Step 1: Write the failing image tests**

Create `packages/cli/test/app-server/image-input.test.ts`:

```ts
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readAtMost, readImageInput } from "../../src/app-server/image-input.ts";

const dir = mkdtempSync(join(tmpdir(), "knightcode-image-"));
// A 1x1 PNG.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
	"base64",
);

test("a path to a PNG becomes the same image as its base64 form", async () => {
	const file = join(dir, "a.png");
	writeFileSync(file, PNG);
	expect(await readImageInput({ path: file })).toEqual({ mimeType: "image/png", data: PNG.toString("base64") });
	expect(await readImageInput({ mimeType: "image/png", data: "AA==" })).toEqual({ mimeType: "image/png", data: "AA==" });
});

test("directories, non-images, missing, relative and oversized paths are refused as invalidParams", async () => {
	mkdirSync(join(dir, "d"));
	writeFileSync(join(dir, "t.txt"), "not an image");
	writeFileSync(join(dir, "big.png"), Buffer.concat([PNG, Buffer.alloc(20 * 1024 * 1024)]));
	for (const path of [join(dir, "d"), join(dir, "t.txt"), join(dir, "missing.png"), "a.png", join(dir, "big.png")]) {
		await expect(readImageInput({ path })).rejects.toMatchObject({ code: "invalidParams" });
	}
});

// Creating symlinks on Windows needs a privilege CI does not have.
test.skipIf(process.platform === "win32")("a symlink to an oversized file is refused by the target's size", async () => {
	const target = join(dir, "huge.png");
	writeFileSync(target, Buffer.concat([PNG, Buffer.alloc(21 * 1024 * 1024)]));
	const link = join(dir, "link.png");
	symlinkSync(target, link);
	await expect(readImageInput({ path: link })).rejects.toMatchObject({ code: "invalidParams" });
});

test("readAtMost keeps reading after short reads and stops one byte past the limit", async () => {
	const source = Buffer.from("0123456789");
	const shortReads = {
		read: async (buffer: Buffer, offset: number, length: number, position: number) => {
			const n = Math.min(3, length, source.length - position); // never more than 3 bytes per call
			if (n <= 0) return { bytesRead: 0 };
			source.copy(buffer, offset, position, position + n);
			return { bytesRead: n };
		},
	};
	expect((await readAtMost(shortReads, 100)).toString()).toBe("0123456789");
	expect((await readAtMost(shortReads, 4)).length).toBe(5);
});
```

Run: `cd packages/cli && bun x vitest --run test/app-server/image-input.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement `image-input.ts`**

```ts
/** `{path}` images (§4.2): the client and server share a disk, so a screenshot need not cross the wire as base64. */

import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ImageInput, ImageRef } from "@knightcode/app-server-protocol";
import { AppServerError } from "./errors.ts";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

const SIGNATURES: { mimeType: string; test: (head: Buffer) => boolean }[] = [
	{ mimeType: "image/png", test: (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
	{ mimeType: "image/jpeg", test: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
	{ mimeType: "image/gif", test: (h) => h.subarray(0, 4).toString("ascii") === "GIF8" },
	{ mimeType: "image/webp", test: (h) => h.subarray(0, 4).toString("ascii") === "RIFF" && h.subarray(8, 12).toString("ascii") === "WEBP" },
];

export interface PositionalReader {
	read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
}

/**
 * Read from the start until end of file or one byte past `limit`, whichever comes first. A single read may
 * return fewer bytes than asked for, so this loops; the extra byte lets the caller tell "exactly at the limit"
 * from "over it" without reading the rest of a huge file.
 */
export async function readAtMost(file: PositionalReader, limit: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let total = 0;
	while (total <= limit) {
		const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, limit + 1 - total));
		const { bytesRead } = await file.read(chunk, 0, chunk.length, total);
		if (bytesRead === 0) break;
		chunks.push(chunk.subarray(0, bytesRead));
		total += bytesRead;
	}
	return Buffer.concat(chunks, total);
}

export async function readImageInput(input: ImageInput): Promise<ImageRef> {
	if (!("path" in input)) return input;
	const refuse = (why: string) => new AppServerError("invalidParams", `image ${input.path}: ${why}`);
	if (!isAbsolute(input.path)) throw refuse("the path must be absolute");
	// Open once and stat the handle, so a file swapped after the check is not the one read. Symlinks are
	// followed by open, so the size checked is the target's.
	const handle = await open(input.path, "r").catch((error: unknown) => {
		throw refuse(`cannot be opened (${(error as NodeJS.ErrnoException).code ?? "error"})`);
	});
	try {
		const stats = await handle.stat();
		if (!stats.isFile()) throw refuse("not a regular file");
		if (stats.size > MAX_IMAGE_BYTES) throw refuse("larger than 20 MiB");
		const bytes = await readAtMost(handle, MAX_IMAGE_BYTES);
		if (bytes.length > MAX_IMAGE_BYTES) throw refuse("larger than 20 MiB");
		if (bytes.length !== stats.size) throw refuse("the file changed while it was read");
		const kind = SIGNATURES.find((s) => s.test(bytes));
		if (!kind) throw refuse("not a PNG, JPEG, GIF or WebP image");
		return { mimeType: kind.mimeType, data: bytes.toString("base64") };
	} catch (error) {
		if (error instanceof AppServerError) throw error;
		// stat or read failing after a successful open (the file was removed, a network drive dropped) is a
		// problem with the path the client gave, not a server fault.
		throw refuse(`cannot be read (${(error as NodeJS.ErrnoException).code ?? String(error)})`);
	} finally {
		await handle.close().catch(() => {});
	}
}
```

Images are read in the handler before the start is admitted (Step 6), so a bad path starts nothing. A `turn/interrupt` sent while the read runs finds no start to cancel; the read is bounded by 20 MiB per image and the client's request is still answered (with `started` or the read's error). The spec says so (§4.4).

Run: `cd packages/cli && bun x vitest --run test/app-server/image-input.test.ts`
Expected: PASS (the symlink test is skipped on Windows).

- [ ] **Step 3: Write the failing turn tests**

Append to `turns.test.ts` (define `PNG` at the top as in the image test; `mkdirSync` from `node:fs`):

```ts
test("an edit's item carries the file's diff, live and read back (§4.2)", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	writeFileSync(join(cwd, "a.txt"), "hello world\n");
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "world", newText: "there" }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "edit" });
	await a.waitFor("turn/completed");
	const live = [...completedItems(a).values()].find((i) => i.tool === "edit") as LiveItem & {
		fileChanges: { path: string; diff?: string }[];
	};
	expect(live.fileChanges[0].diff).toContain("-hello world");
	expect(live.fileChanges[0].diff).toContain("+hello there");
	const [turn] = await a.readTurns(thread.id);
	const read = turn.items.find((i) => i.type === "toolCall") as { fileChanges: unknown };
	expect(read.fileChanges).toEqual(live.fileChanges);
});

// `Type` from "typebox" for the test tool's parameters.
const DIFF = ["@@ -1 +1 @@", "-a", "+b"].join("\n");

test("an extension tool's reported fileChanges are kept, live and read back; a malformed report is ignored", async () => {
	const { cwd, faux, connect } = await startServer({
		extraExtensions: [
			{
				name: "reporting-tool",
				factory: (k) => {
					k.registerTool({
						name: "rename_symbol",
						label: "Rename symbol",
						description: "Test tool that reports the files it changed.",
						parameters: Type.Object({ ok: Type.Boolean() }),
						execute: async (_id, params: { ok: boolean }) => ({
							content: [{ type: "text", text: "renamed" }],
							details: params.ok
								? { fileChanges: [{ path: "src/a.ts", kind: "modify", diff: DIFF }, { path: "src/new.ts", kind: "add" }] }
								: { fileChanges: [{ path: "src/a.ts", kind: "rename" }] },
						}),
					});
				},
			},
		],
	});
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("rename_symbol", { ok: true }), fauxToolCall("rename_symbol", { ok: false })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "rename" });
	await a.waitFor("turn/completed");
	const calls = [...completedItems(a).values()].filter((i) => i.tool === "rename_symbol") as Array<LiveItem & { fileChanges?: unknown }>;
	expect(calls[0].fileChanges).toEqual([
		{ path: "src/a.ts", kind: "modify", diff: DIFF },
		{ path: "src/new.ts", kind: "add" },
	]);
	expect(calls[1].fileChanges).toBeUndefined();
	const [turn] = await a.readTurns(thread.id);
	const read = turn.items.filter((i) => i.type === "toolCall") as Array<{ fileChanges?: unknown }>;
	expect(read.map((i) => i.fileChanges)).toEqual(calls.map((i) => i.fileChanges));
});

const userItems = (c: TestClient) =>
	c.notifications
		.filter((n) => n.method === "item/completed" && itemOf(n).type === "userMessage")
		.map((n) => n.params.item as { text: string; clientMessageId?: string });

test("clientMessageId follows the message, not its text: template expansion and input hooks (§4.2)", async () => {
	const { cwd, faux, agentDir, connect } = await startServer({
		extraExtensions: [
			{
				name: "rewrite",
				factory: (k) => {
					k.on("input", (event) =>
						event.text === "rewrite me" ? { action: "transform", text: "rewritten by a hook" } : { action: "continue" },
					);
				},
			},
		],
	});
	mkdirSync(join(agentDir, "prompts"), { recursive: true });
	writeFileSync(join(agentDir, "prompts", "greet.md"), "Say hello to $1");
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("one")]), fauxAssistantMessage([fauxText("two")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "/greet Bob", clientMessageId: "c-1" });
	await a.waitFor("turn/completed");
	await a.client.request("turn/start", { threadId: thread.id, text: "rewrite me", clientMessageId: "c-2" });
	await vi.waitFor(() => expect(turnsCompleted(a)).toHaveLength(2));
	expect(userItems(a).map((u) => [u.text, u.clientMessageId])).toEqual([
		["Say hello to Bob", "c-1"],
		["rewritten by a hook", "c-2"],
	]);
	const turns = await a.readTurns(thread.id);
	expect(turns.flatMap((t) => t.items).some((i) => "clientMessageId" in i)).toBe(false);
});

test("an input a hook handles creates no message and echoes nothing", async () => {
	const { cwd, connect } = await startServer({
		extraExtensions: [
			{ name: "swallow", factory: (k) => k.on("input", (event) => (event.text === "skip me" ? { action: "handled" } : { action: "continue" })) },
		],
	});
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	const result = await a.client.request("turn/start", { threadId: thread.id, text: "skip me", clientMessageId: "c-9" });
	expect(result.status).toBe("handled");
	expect(userItems(a)).toEqual([]);
});

test("turn/start with an image path stores the image; a bad path starts nothing", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const file = join(cwd, "shot.png");
	writeFileSync(file, PNG);
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("I see it")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "look", images: [{ path: file }], clientMessageId: "c-3" });
	await a.waitFor("turn/completed");
	const [turn] = await a.readTurns(thread.id);
	const user = turn.items.find((i) => i.type === "userMessage") as { images: { mimeType: string; data: string }[] };
	expect(user.images).toEqual([{ mimeType: "image/png", data: PNG.toString("base64") }]);
	// Image processing may append a hint to the text; the id still matches.
	expect(userItems(a)[0].clientMessageId).toBe("c-3");
	await expect(
		a.client.request("turn/start", { threadId: thread.id, text: "x", images: [{ path: join(cwd, "nope.png") }] }),
	).rejects.toMatchObject({ code: "invalidParams" });
	expect(a.notifications.filter((n) => n.method === "turn/started")).toHaveLength(1);
});
```

Check that the prompt-template directory the resource loader reads under `agentDir` is `prompts/` (`package-manager.ts:2428`) and that a template is invoked as `/greet Bob` with `$1` substitution (`docs/prompt-templates.md`).

Run: `cd packages/cli && bun x vitest --run test/app-server/turns.test.ts -t "diff|clientMessageId|hook handles|image path"`
Expected: FAIL.

- [ ] **Step 4: Change the schemas**

```ts
export const FileChange = Obj({
	path: Str,
	kind: Type.Union([Type.Literal("add"), Type.Literal("modify"), Type.Literal("delete")]),
	diff: Type.Optional(Str),
});
export const ImageInput = Type.Union([ImageRef, Obj({ path: Str })]);
export type ImageInput = Static<typeof ImageInput>;
const ClientMessageId = Type.String({ minLength: 1, maxLength: 128 });
```

The `userMessage` variant gains `clientMessageId: Type.Optional(ClientMessageId)`. `turn/start` params: `images: Type.Optional(Type.Array(ImageInput))`, `clientMessageId: Type.Optional(ClientMessageId)`. `TurnInput` (steer and follow-up) likewise; Task 5 adds `expectedTurnId` and wires the queue paths.

- [ ] **Step 5: Diffs from the tool result**

`transcript.ts`:

```ts
const MAX_REPORTED_CHANGES = 1000;
const KINDS: ReadonlySet<string> = new Set(["add", "modify", "delete"]);

/** An extension tool's own report (§4.2): `details.fileChanges`, kept only if every entry is well formed. */
function reportedChanges(details: unknown): FileChange[] | undefined {
	const reported = typeof details === "object" && details !== null ? (details as { fileChanges?: unknown }).fileChanges : undefined;
	if (!Array.isArray(reported) || reported.length > MAX_REPORTED_CHANGES) return undefined;
	const changes: FileChange[] = [];
	for (const entry of reported) {
		if (typeof entry !== "object" || entry === null) return undefined;
		const { path, kind, diff } = entry as { path?: unknown; kind?: unknown; diff?: unknown };
		if (typeof path !== "string" || typeof kind !== "string" || !KINDS.has(kind)) return undefined;
		if (diff !== undefined && typeof diff !== "string") return undefined;
		changes.push({ path, kind: kind as FileChange["kind"], ...(typeof diff === "string" && diff.length > 0 ? { diff } : {}) });
	}
	return changes;
}

export function fileChangesOf(tool: string, input: unknown, isError: boolean, details?: unknown): FileChange[] {
	if (isError) return [];
	if (tool === "edit" || tool === "write") {
		const path = typeof input === "object" && input !== null ? (input as { path?: unknown }).path : undefined;
		if (typeof path !== "string") return [];
		const patch = typeof details === "object" && details !== null ? (details as { patch?: unknown }).patch : undefined;
		return [{ path, kind: "modify", ...(typeof patch === "string" && patch.length > 0 ? { diff: patch } : {}) }];
	}
	return reportedChanges(details) ?? [];
}
```

Both callers pass the tool result message's `details` (`message.details` on the `toolResult` message in `readTurns`; the same field on the `message_end` message in the mapper). A malformed report is ignored whole rather than half-used; an item whose reported diffs make it larger than 64 KiB travels as an `ItemReference` like any large item (§5.9).

- [ ] **Step 6: The id follows the message object**

`agent-session.ts`:

```ts
// PromptOptions
/** A client's id for this input. Attached to the message built from it, never stored in the session file. */
clientMessageId?: string;

// fields
/** Message object -> the client id of the input it was built from. Weak: removed or delivered messages take it with them. */
private readonly _clientMessageIds = new WeakMap<AgentMessage, string>();

clientMessageIdOf(message: AgentMessage): string | undefined {
	return this._clientMessageIds.get(message);
}
```

In `prompt()`, where the user message is built after hooks and image normalization (`:2197-2205`), keep the object and register it:

```ts
const userMessage: AgentMessage = { role: "user", content: userContent, timestamp: Date.now() };
if (options?.clientMessageId) this._clientMessageIds.set(userMessage, options.clientMessageId);
messages.push(userMessage);
```

Only that object gets the id: the pending "next turn" context and hook messages pushed after it do not. An input a command or hook handles never reaches this point, so nothing is registered and nothing is echoed. A command that replaces the session and dispatches a prompt there (`withSession`) dispatches its own text without a `clientMessageId`, so the replacement's user message carries none either; the client reconciles that case by the request's result and by `turn/completed` (desktop-shell.md section 7.2).

`threads.ts` resolves images first, then passes the id through:

```ts
"turn/start": async ({ threadId, text, images, requestId, clientMessageId }, connection) => {
	const resolved = images && (await Promise.all(images.map(readImageInput)));
	return this.startTurn(threadId, text, resolved, connection, requestId, clientMessageId);
},
```

`startTurn` adds `clientMessageId` to the options it passes to `session.prompt` (`threads.ts:683`). Nothing is stored on `LoadedThread`; there is no array to clean up on a cancelled, handled or rejected start.

`item-mapper.ts`, user `message_end`:

```ts
const clientMessageId = this.thread.session.clientMessageIdOf(message);
this.appendWhole(
	{
		type: "userMessage",
		id: `${this.turn.id}:user:${counters.users++}`,
		text: textOf(content),
		images: content.flatMap((c) => (c.type === "image" ? [{ mimeType: c.mimeType, data: c.data }] : [])),
		...(clientMessageId ? { clientMessageId } : {}),
		completedAt: message.timestamp,
	},
	counters,
);
```

Read-back never sets `clientMessageId`.

- [ ] **Step 7: Run the tests and the type check**

Run: `cd packages/cli && bun x vitest --run test/app-server/`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS.

- [ ] **Step 8: Commit** (if authorized)

```bash
git add packages/cli/src/app-server/image-input.ts packages/cli/test/app-server/image-input.test.ts packages/cli/src/core/agent-session.ts packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/src/app-server/transcript.ts packages/cli/src/app-server/item-mapper.ts packages/cli/src/app-server/threads.ts packages/cli/docs/app-server.schema.json packages/cli/test/app-server/turns.test.ts
git commit -m "feat(cli): file change diffs, client message ids carried by message identity, image paths on turn input"
```

---

### Task 5: Turn identity on steer, follow-up and interrupt; queue entries removable until delivery

The delivery boundary decides what "removable" means, so it is defined first. The agent loop drains a queued message into a local list (`agent-loop.ts:296`, after `turn_end`), then awaits `prepareNextTurn`, which can run a compaction, and the steering poll (`:184-206`), and only then emits the message (`:211-217`). Searching the queues alone would answer "not removable" for a message that is drained but not yet delivered, and the loop would deliver it anyway. So:

- **Delivery boundary.** A queued message is delivered when the loop commits it: synchronously, after `prepareNextTurn` and the steering poll have returned, before `turn_start` and its `message_start` are emitted. Until then it can be withdrawn; after it, it cannot.
- **Removal.** `Agent.removeQueued(message)` takes the message out of its queue, or, if the loop has drained it but not committed it, marks it withdrawn so the commit drops it. It answers `true` exactly when the message will not be delivered.
- **Nothing left to answer.** The loop records why it is about to make each request: the prompt's own input, tool results, queued input, or an explicit continuation. Only a request made for queued input can turn out to be empty; if every message it was for was withdrawn, no request is made and no turn starts. Requests for tool results and explicit continuations always happen.
- **Other drains and clears.** `Agent.continue()` drains the queues itself and sends what it drained as the run's input: those messages are committed at once. Clearing a queue also withdraws the messages of that kind that were drained but not committed.

The composer can therefore offer Edit and Remove on a queued message until its `userMessage` item appears (desktop-shell.md section 9.4); a `removed: false` answer means it was already committed, and the item follows.

`clientMessageId` for steers and follow-ups uses Task 4's mechanism: the session registers the id on the message object it builds in `_queueSteer` / `_queueFollowUp`, so a withdrawn message takes its id with it and two queued messages with the same text keep their own ids.

**Files:**
- Modify: `packages/agent/src/agent.ts`, `packages/agent/src/agent-loop.ts`, `packages/agent/src/types.ts` (`AgentLoopConfig.commitPending`)
- Test: `packages/agent/test/agent.test.ts`, `packages/agent/test/agent-loop.test.ts`
- Modify: `packages/cli/src/core/agent-session.ts`
- Test: `packages/cli/test/agent-session-queue.test.ts` (new)
- Modify: `packages/app-server-protocol/src/protocol.ts`, `test/protocol.test.ts`
- Modify: `packages/cli/src/app-server/threads.ts`, `item-mapper.ts`
- Test: `packages/cli/test/app-server/turns.test.ts`, and every app-server test that calls `turn/steer` or `turn/followUp`
- Modify: `apps/desktop/docs/desktop-app/architecture.md` §§4.4–4.6, `desktop-shell.md` §§7.1, 9.4 (resume queue snapshot)

**Interfaces:**
- Produces (agent): `Agent.removeQueued(message: AgentMessage): boolean`; `AgentLoopConfig.commitPending?: (messages: AgentMessage[]) => AgentMessage[]`.
- Produces (session): `PromptOptions.queueId?: string`; `QueueEntry = { id: string; kind: "steer" | "followUp"; text: string }`; `AgentSessionEvent` `queue_update` gains `entries: readonly QueueEntry[]` (the existing `steering` / `followUp` string arrays stay for the terminal); `AgentSession.removeQueued(id: string): boolean`; `AgentSession.getQueueEntries(): readonly QueueEntry[]` returns a value snapshot, not internal message objects.
- Produces (protocol): `TurnQueue = { steering: {id, text}[]; followUp: {id, text}[] }`; `thread/resume` gains required `queue: TurnQueue`; `turn/steer` and `turn/followUp` params gain required `expectedTurnId: Str`, result `{ queueId: Str }`; `turn/interrupt` params gain `turnId?: Str`; `turn/queue/updated` becomes `{ threadId, ...TurnQueue }`; new `turn/queue/remove {threadId, queueId} → {removed: Bool}`.
- Produces (server): `queueOf(session: AgentSession): TurnQueue` exported from `item-mapper.ts`, used for both notifications and the synchronous resume commit.
- Consumes: Task 0's `createHeldTurn`; Task 4's `clientMessageIdOf`.

- [ ] **Step 1: Agent tests first: the drained window, withdrawn follow-ups and steers, continue(), clearing**

Append to `packages/agent/test/agent.test.ts`. The helpers mirror the "keeps legacy prepareNextTurn signal callback behavior" test (`:859-895`): `createAssistantMessageEventStream`, `createAssistantMessage`, `createAssistantToolUseMessage` from that file's imports.

```ts
const userText = (text: string, timestamp = Date.now()) => ({
	role: "user" as const,
	content: [{ type: "text" as const, text }],
	timestamp,
});

/** A scripted model: each call pops the next reply, and the test sees every request's context. */
function scripted(replies: Array<"tool" | "text">) {
	const contexts: string[] = [];
	const streamFn = (_model: unknown, context: { messages: unknown[] }) => {
		contexts.push(JSON.stringify(context.messages));
		const stream = createAssistantMessageEventStream();
		const reply = replies[contexts.length - 1] ?? "text";
		queueMicrotask(() => {
			const message =
				reply === "tool"
					? createAssistantToolUseMessage([{ type: "toolCall", id: `tool-${contexts.length}`, name: "noop", arguments: {} }])
					: createAssistantMessage(`reply ${contexts.length}`);
			stream.push({ type: "done", reason: reply === "tool" ? "toolUse" : "stop", message });
		});
		return stream;
	};
	return { contexts, streamFn };
}

const noopTool = (onRun: () => void = () => {}) => ({
	name: "noop",
	label: "Noop",
	description: "Noop tool",
	parameters: Type.Object({}),
	execute: async () => {
		onRun();
		return { content: [{ type: "text" as const, text: "ok" }], details: {} };
	},
});

const turnStarts = (agent: Agent) => {
	let count = 0;
	agent.subscribe((event) => {
		if (event.type === "turn_start") count++;
	});
	return () => count;
};

/** turn_start events of a plain one-reply prompt: what a run whose queued input was all withdrawn must match. */
async function baselineTurnStarts(): Promise<number> {
	const agent = new Agent({ streamFn: scripted(["text"]).streamFn });
	const starts = turnStarts(agent);
	await agent.prompt("start");
	return starts();
}

it("removeQueued takes a queued message out before the loop drains it", () => {
	const agent = new Agent({ streamFn: () => createAssistantMessageEventStream() });
	const a = userText("a", 1);
	const b = userText("a", 2);
	agent.followUp(a);
	agent.followUp(b);
	expect(agent.removeQueued(a)).toBe(true);
	expect(agent.removeQueued(a)).toBe(false);
	expect(agent.hasQueuedMessages()).toBe(true); // b: same text, another object, untouched
});

it("a steer drained before prepareNextTurn can still be withdrawn; the tool results are still answered", async () => {
	const withdrawn = userText("withdraw me");
	const model = scripted(["tool", "text"]);
	let removed: boolean | undefined;
	const agent: Agent = new Agent({
		initialState: { tools: [noopTool(() => agent.steer(withdrawn))] }, // queued while the tool runs; drained after turn_end
		prepareNextTurn: async () => {
			expect(agent.hasQueuedMessages()).toBe(false); // drained, not yet delivered: the window under test
			removed = agent.removeQueued(withdrawn);
			return undefined;
		},
		streamFn: model.streamFn,
	});
	await agent.prompt("start");
	expect(removed).toBe(true);
	expect(model.contexts).toHaveLength(2); // the tool result still gets its reply
	expect(model.contexts[1]).not.toContain("withdraw me");
	expect(JSON.stringify(agent.state.messages)).not.toContain("withdraw me");
});

it("withdrawing the only follow-up makes no further request and starts no turn", async () => {
	const followUp = userText("follow me");
	const model = scripted(["text"]);
	let removed: boolean | undefined;
	const agent: Agent = new Agent({
		prepareNextTurn: async () => {
			removed = agent.removeQueued(followUp); // drained by the outer loop, awaiting this hook
			return undefined;
		},
		streamFn: (m, c) => {
			if (model.contexts.length === 0) agent.followUp(followUp); // queued while the first reply streams
			return model.streamFn(m, c);
		},
	});
	const starts = turnStarts(agent);
	await agent.prompt("start");
	expect(removed).toBe(true);
	expect(model.contexts).toHaveLength(1);
	expect(starts()).toBe(await baselineTurnStarts());
});

it("withdrawing the only steer after a reply without tool calls makes no further request", async () => {
	const steer = userText("steer me");
	const model = scripted(["text"]);
	const agent: Agent = new Agent({
		prepareNextTurn: async () => {
			agent.removeQueued(steer);
			return undefined;
		},
		streamFn: (m, c) => {
			if (model.contexts.length === 0) agent.steer(steer);
			return model.streamFn(m, c);
		},
	});
	const starts = turnStarts(agent);
	await agent.prompt("start");
	expect(model.contexts).toHaveLength(1);
	expect(starts()).toBe(await baselineTurnStarts());
});

it("clearing the queues also withdraws drained, uncommitted messages", async () => {
	const steer = userText("cleared");
	const model = scripted(["tool", "text"]);
	const agent: Agent = new Agent({
		initialState: { tools: [noopTool(() => agent.steer(steer))] },
		prepareNextTurn: async () => {
			agent.clearAllQueues();
			return undefined;
		},
		streamFn: model.streamFn,
	});
	await agent.prompt("start");
	expect(model.contexts.at(-1)).not.toContain("cleared");
});

it("continue() commits what it drains at once: removal after it answers false and the message is sent", async () => {
	const model = scripted(["text", "text"]);
	const agent = new Agent({ streamFn: model.streamFn });
	await agent.prompt("start"); // the transcript now ends with an assistant message
	const queued = userText("continue with me");
	agent.followUp(queued);
	const running = agent.continue(); // drains synchronously before its first await
	expect(agent.removeQueued(queued)).toBe(false);
	await running;
	expect(model.contexts[1]).toContain("continue with me");
});
```

Add the combined case below; separate continuation and withdrawal tests do not catch a drain that clears an
outstanding continuation before commit:

```ts
it.each([
	["steer", true],
	["steer", false],
	["followUp", true],
	["followUp", false],
] as const)("a %s with withdrawal=%s still fulfills finishTurn's continuation exactly once", async (kind, withdraw) => {
	const queued = userText("continuation input");
	const model = scripted(["text", "text"]);
	let removed: boolean | undefined;
	const agent: Agent = new Agent({
		finishTurn: () => model.contexts.length === 1 ? { action: "continue" } : undefined,
		prepareNextTurn: async () => {
			if (withdraw) removed = agent.removeQueued(queued);
			return undefined;
		},
		streamFn: (m, c) => {
			if (model.contexts.length === 0) agent[kind](queued);
			return model.streamFn(m, c);
		},
	});
	await agent.prompt("start");
	expect(model.contexts).toHaveLength(2); // a surviving queued request satisfies it; withdrawal cannot erase it
	if (withdraw) {
		expect(removed).toBe(true);
		expect(model.contexts[1]).not.toContain("continuation input");
		expect(JSON.stringify(agent.state.messages)).not.toContain("continuation input");
	} else {
		expect(model.contexts[1]).toContain("continuation input");
	}
});
```

Existing tests that must keep passing unchanged and pin the requests that must still happen: the explicit-continuation tests in `agent-loop.test.ts` (a `finishTurn` returning `continue` still produces its context-only request), and every steering and follow-up test in both files.

Run: `cd packages/agent && bun x vitest --run test/agent.test.ts test/agent-loop.test.ts`
Expected: FAIL — `removeQueued` does not exist; the withdrawn messages are delivered and the follow-up case makes two requests.

- [ ] **Step 2: Implement the boundary and request reasons**

`types.ts`, in `AgentLoopConfig` beside `getSteeringMessages`:

```ts
/**
 * Called once per turn, synchronously, after prepareNextTurn and the steering poll and before turn_start: the
 * delivery boundary. Returns the queued messages to deliver; anything it drops was withdrawn and is never sent.
 */
commitPending?: (messages: AgentMessage[]) => AgentMessage[];
```

`agent-loop.ts`, `runLoop`. Today `hasMoreToolCalls` starts as `true` on every pass of the outer loop (`:181`), including a pass entered only because follow-ups arrived, so it cannot tell "tool results need a reply" from "a follow-up is pending". The loop records why it is about to make a request instead:

```ts
/** Why the next model request is made. Only a request made for queued input can find it has nothing to answer. */
type RequestReason = "initial" | "toolResults" | "queued" | "continuation";

// in runLoop, before the outer loop
let reason: RequestReason = "initial";

while (true) {
	let hasMoreToolCalls = true;
	while (hasMoreToolCalls || pendingMessages.length > 0) {
		let preparedMessages: AgentMessage[] = [];
		if (lastCompletedTurn) {
			// ...prepareNextTurn and the steering poll, unchanged, except that turn_start is no longer emitted here...
		}
		// The delivery boundary: no await between here and the turn_start emit below.
		const queued = pendingMessages;
		pendingMessages = config.commitPending ? config.commitPending(queued) : queued;
		if (
			reason === "queued" &&
			!explicitContinuation &&
			queued.length > 0 &&
			pendingMessages.length === 0 &&
			preparedMessages.length === 0
		) {
			// Every message this request was for was withdrawn: nothing to answer, no turn.
			hasMoreToolCalls = false;
			break;
		}
		if (lastCompletedTurn) await emit({ type: "turn_start" });
		// ...delivery of [...preparedMessages, ...pendingMessages] and prepareRequest, unchanged...
		explicitContinuation = false; // only the request we are now making satisfies the previous obligation
		// ...streamAssistantResponse, tool execution, finishTurn and turn_end, unchanged...
		// The existing assignment explicitContinuation = decision?.action === "continue" records the NEW obligation.
		pendingMessages = (await config.getSteeringMessages?.()) || [];
		reason = hasMoreToolCalls ? "toolResults" : "queued";
	}

	const followUpMessages = (await config.getFollowUpMessages?.()) || [];
	if (followUpMessages.length > 0) {
		pendingMessages = followUpMessages;
		reason = "queued";
		continue;
	}
	if (explicitContinuation) {
		reason = "continuation";
		continue;
	}
	break;
}
```

Why each request still happens when it should: the first pass is `initial` (the prompt's own input); a pass after tool calls is `toolResults` even if a steer was withdrawn. `explicitContinuation` is an independent obligation, not cleared when either queue is drained or when the continuation pass is selected. A surviving queued or tool-result request satisfies it once; if queued input is withdrawn during preparation, the same pass still makes its mandatory request. Clear it only immediately before `streamAssistantResponse`, after `prepareRequest`; the subsequent `finishTurn` decision may create a new obligation. Only `queued` passes with no continuation can end early, and only when everything they were for was withdrawn and `prepareNextTurn` added nothing. The `turn_start` emit moves from inside the `if (lastCompletedTurn)` block (`:204`) to after the commit; nothing between them awaits, and its order relative to `message_start` is unchanged.

`agent.ts`:

```ts
// PendingMessageQueue
remove(message: AgentMessage): boolean {
	const index = this.messages.indexOf(message);
	if (index === -1) return false;
	this.messages.splice(index, 1);
	return true;
}

// Agent fields
/** Drained by the loop but not yet committed for delivery: still withdrawable. */
private readonly drainedSteering = new Set<AgentMessage>();
private readonly drainedFollowUps = new Set<AgentMessage>();
private readonly withdrawn = new WeakSet<AgentMessage>();

/** Withdraw a queued steer or follow-up by identity. True exactly when it will not be delivered. */
removeQueued(message: AgentMessage): boolean {
	if (this.steeringQueue.remove(message) || this.followUpQueue.remove(message)) return true;
	if (!this.drainedSteering.delete(message) && !this.drainedFollowUps.delete(message)) return false;
	this.withdrawn.add(message);
	return true;
}

private withdrawAll(drained: Set<AgentMessage>): void {
	for (const message of drained) this.withdrawn.add(message);
	drained.clear();
}
```

`clearSteeringQueue()` (`:309`) also calls `this.withdrawAll(this.drainedSteering)`, `clearFollowUpQueue()` (`:314`) `this.withdrawAll(this.drainedFollowUps)`; `clearAllQueues()` calls both already. Clearing means "none of these is sent", including the ones the loop drained but has not committed.

In the loop config (`:494-500`):

```ts
getSteeringMessages: async () => {
	if (skipInitialSteeringPoll) {
		skipInitialSteeringPoll = false;
		return [];
	}
	return this.track(this.drainedSteering, this.steeringQueue.drain());
},
getFollowUpMessages: async () => this.track(this.drainedFollowUps, this.followUpQueue.drain()),
commitPending: (messages) =>
	messages.filter((message) => {
		this.drainedSteering.delete(message);
		this.drainedFollowUps.delete(message);
		return !this.withdrawn.has(message);
	}),
```

with `private track(into: Set<AgentMessage>, messages: AgentMessage[]): AgentMessage[] { for (const m of messages) into.add(m); return messages; }`. `runWithLifecycle`'s cleanup clears both drained sets: a run that ends (an abort) no longer holds them.

`continue()` (`:395-414`) drains the queues itself and passes what it drained to `runPromptMessages` as the run's own input. Those messages are committed at that moment, not tracked as drained: `removeQueued` answers `false` for them and they are delivered, which the last test pins. This is the one other drain path; `rg -n "\.drain\(\)" packages/agent/src` must list only the two loop getters and `continue()`.

Run: `cd packages/agent && bun x vitest --run`
Expected: PASS, including every existing agent and loop test.

- [ ] **Step 3: Session queue entries, test first**

Create `packages/cli/test/agent-session-queue.test.ts`. The harness builds a real `AgentSession` on the faux provider; the held turn keeps it running without timing:

```ts
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import type { AgentSession, QueueEntry } from "../src/core/agent-session.ts";
import { createHeldTurn } from "./app-server/fixtures/held-turn-extension.ts";
import { cleanupServers, startServer } from "./app-server/harness.ts";

afterEach(cleanupServers);

const userTexts = (s: AgentSession) =>
	s.messages
		.filter((m) => m.role === "user")
		.map((m) =>
			typeof m.content === "string" ? m.content : m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join(""),
		);

test("queued follow-ups carry ids; one removed by id never reaches the model", async () => {
	const held = createHeldTurn();
	const { cwd, faux, threads, connect } = await startServer({ extraExtensions: [{ name: "held-turn", factory: held.extension }] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	const session = threads.get(thread.id).session;
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("after hold")]),
		fauxAssistantMessage([fauxText("answering the follow-up")]),
	]);
	const updates: QueueEntry[][] = [];
	session.subscribe((e) => {
		if (e.type === "queue_update") updates.push([...e.entries]);
	});
	const running = session.prompt("start");
	await held.entered;
	await session.followUp("later", undefined, { queueId: "q1" });
	await session.followUp("unnamed");
	expect(updates.at(-1)![0]).toEqual({ id: "q1", kind: "followUp", text: "later" });
	expect(updates.at(-1)![1].id).toMatch(/^[0-9a-f-]{36}$/);
	const snapshot = session.getQueueEntries();
	expect(snapshot).toEqual(updates.at(-1));
	expect(snapshot[0]).not.toHaveProperty("message");
	snapshot[0].text = "changed copy";
	expect(session.getQueueEntries()[0].text).toBe("later"); // returned values do not alias session state
	expect(session.removeQueued("q1")).toBe(true);
	expect(snapshot[0].id).toBe("q1"); // an earlier snapshot does not change when the live queue changes
	expect(updates.at(-1)!.map((e) => e.text)).toEqual(["unnamed"]);
	expect(session.getFollowUpMessages()).toEqual(["unnamed"]);
	held.release();
	await running;
	await session.waitForIdle();
	expect(userTexts(session)).toEqual(["start", "unnamed"]);
	expect(session.removeQueued("q1")).toBe(false);
});
```

Run: `cd packages/cli && bun x vitest --run test/agent-session-queue.test.ts`
Expected: FAIL — `entries` is undefined, `queueId` is not an option, `removeQueued` does not exist.

- [ ] **Step 4: Implement session queue entries and their client ids**

`agent-session.ts`:

```ts
export interface QueueEntry {
	id: string;
	kind: "steer" | "followUp";
	text: string;
}

// PromptOptions
/** Id of the queue entry this input becomes when it is queued; generated when absent. */
queueId?: string;

// fields
private _queueEntries: Array<QueueEntry & { message: AgentMessage }> = [];

getQueueEntries(): readonly QueueEntry[] {
	return this._queueEntries.map(({ id, kind, text }) => ({ id, kind, text }));
}
```

`steer()`, `followUp()` and `_queueUserInput()` widen their option picks to `"source" | "signal" | "preflightResult" | "queueId" | "clientMessageId"` and pass both through. `_queueSteer` becomes (and `_queueFollowUp` the same with `kind: "followUp"` and `agent.followUp`):

```ts
private async _queueSteer(text: string, images: ImageContent[] | undefined, options: { queueId?: string; clientMessageId?: string } = {}): Promise<void> {
	this._steeringMessages.push(text);
	const content: (TextContent | ImageContent)[] = [{ type: "text", text }];
	if (images) content.push(...images);
	const message: AgentMessage = { role: "user", content, timestamp: Date.now() };
	if (options.clientMessageId) this._clientMessageIds.set(message, options.clientMessageId);
	this._queueEntries.push({ id: options.queueId ?? randomUUID(), kind: "steer", text, message });
	this._emitQueueUpdate();
	this.agent.steer(message);
}

removeQueued(id: string): boolean {
	const index = this._queueEntries.findIndex((entry) => entry.id === id);
	if (index === -1) return false;
	const entry = this._queueEntries[index];
	if (!this.agent.removeQueued(entry.message)) return false;
	this._queueEntries.splice(index, 1);
	const list = entry.kind === "steer" ? this._steeringMessages : this._followUpMessages;
	const textIndex = list.indexOf(entry.text);
	if (textIndex !== -1) list.splice(textIndex, 1);
	this._emitQueueUpdate();
	return true;
}

private _emitQueueUpdate(): void {
	this._emit({
		type: "queue_update",
		steering: [...this._steeringMessages],
		followUp: [...this._followUpMessages],
		entries: this.getQueueEntries(),
	});
}
```

Where a user `message_start` removes a delivered message from the string queues (`:1196-1206`), remove the `_queueEntries` element whose `message` is that exact object (`entry.message === event.message`), not the first one with matching text. `clearQueue()` empties `_queueEntries`. Add `entries` to the `queue_update` member of `AgentSessionEvent`. The terminal's `queue_update` handler (`interactive-mode.ts:3448`) keeps reading `steering` and `followUp` and needs no change.

Run: `cd packages/cli && bun x vitest --run test/agent-session-queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Protocol tests first**

Append to `turns.test.ts` (`createHeldTurn` from `./fixtures/held-turn-extension.ts`; `userItems` from Task 4):

```ts
const heldServer = async () => {
	const held = createHeldTurn();
	const server = await startServer({ extraExtensions: [{ name: "held-turn", factory: held.extension }] });
	return { held, ...server };
};
const turnIdOf = (p: Record<string, unknown>) => (p.turn as { id: string }).id;

test("a steer or interrupt naming a turn that is no longer running answers turnMismatch", async () => {
	const { held, cwd, faux, connect } = await heldServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxText("one")]),
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("two")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "first" });
	const first = turnIdOf(await a.waitFor("turn/started"));
	await a.waitFor("turn/completed");
	await a.client.request("turn/start", { threadId: thread.id, text: "second" });
	await held.entered;
	await expect(
		a.client.request("turn/steer", { threadId: thread.id, expectedTurnId: first, text: "late" }),
	).rejects.toMatchObject({ code: "turnMismatch" });
	await expect(a.client.request("turn/interrupt", { threadId: thread.id, turnId: first })).rejects.toMatchObject({
		code: "turnMismatch",
	});
	held.release();
	const done = await a.waitFor("turn/completed", (p) => turnIdOf(p) !== first);
	expect((done.turn as { status: string }).status).toBe("completed");
	const turns = await a.readTurns(thread.id);
	expect(turns.flatMap((t) => t.items).some((i) => i.type === "userMessage" && i.text === "late")).toBe(false);
});

test("queued input: ids per message, removal before delivery, same text kept apart, removed ids not reused", async () => {
	const { held, cwd, faux, connect } = await heldServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("after the steer")]),
		// Follow-ups are delivered one per turn (the default one-at-a-time mode).
		fauxAssistantMessage([fauxText("after the first follow-up")]),
		fauxAssistantMessage([fauxText("after the second follow-up")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go", clientMessageId: "c-0" });
	const turnId = turnIdOf(await a.waitFor("turn/started"));
	await held.entered;
	const input = (kind: "turn/steer" | "turn/followUp", text: string, clientMessageId: string) =>
		a.client.request(kind, { threadId: thread.id, expectedTurnId: turnId, text, clientMessageId });
	await input("turn/steer", "same", "c-steer"); // delivered after the tool result
	await input("turn/followUp", "same", "c-follow"); // delivered after the run would stop: later than the steer
	const { queueId } = await input("turn/followUp", "dup", "c-removed");
	expect(await a.client.request("turn/queue/remove", { threadId: thread.id, queueId })).toEqual({ removed: true });
	await input("turn/followUp", "dup", "c-kept");
	held.release();
	await a.waitFor("turn/completed");
	expect(userItems(a).map((u) => [u.text, u.clientMessageId])).toEqual([
		["go", "c-0"],
		["same", "c-steer"],
		["same", "c-follow"],
		["dup", "c-kept"],
	]);
	expect(await a.client.request("turn/queue/remove", { threadId: thread.id, queueId })).toEqual({ removed: false });
});

test("removing a follow-up after it was delivered answers removed: false", async () => {
	const { held, cwd, faux, connect } = await heldServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
		fauxAssistantMessage([fauxText("answered")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	const turnId = turnIdOf(await a.waitFor("turn/started"));
	await held.entered;
	const { queueId } = await a.client.request("turn/followUp", { threadId: thread.id, expectedTurnId: turnId, text: "then this" });
	held.release();
	await a.waitFor("item/completed", (p) => (p.item as { text?: string }).text === "then this");
	expect(await a.client.request("turn/queue/remove", { threadId: thread.id, queueId })).toEqual({ removed: false });
	await a.waitFor("turn/completed");
});
```

Add resume-snapshot tests in `turns.test.ts` using the same held turn:
- Queue one steer and one follow-up before connecting `b`. Resume on `b` while held and assert
  `resumed.queue === { steering: [{ id: steerId, text: "steer" }], followUp: [{ id: followId, text: "later" }] }`.
  Remove the follow-up from `a`; `b`'s next `turn/queue/updated` contains the steer and no follow-up. Release in
  `finally`, then assert its delivered steer disappears from `b`'s queue. An idle resume returns both arrays empty.
- Gate `threads.resume` in the test **after** it produces its `Commit` but **before** the handler returns that
  commit to the server. A gate on `transport.send` is too late: the server has already executed the commit.
  `vi.spyOn(threads, "resume").mockImplementationOnce(async (...args) => { const result = await originalResume(...args);
  enter(); await gate; return result; })`, with `originalResume = threads.resume.bind(threads)`, is sufficient.
  Start `b`'s resume, await the gate's entered promise, remove or add an entry from `a`, then open the gate in
  `finally`. Assert the response's `queue` reflects the change, not the queue at handler entry. Changes after the
  response appear as notifications, in order. Restore the spy after the test; no timer or production test hook.
- Resuming with an invalid cursor establishes no subscription and exposes no queue snapshot.

Update every existing `turn/steer` and `turn/followUp` call in `packages/cli/test/app-server/*.test.ts` (`rg -n "turn/steer|turn/followUp" packages/cli/test/app-server`) to pass `expectedTurnId` from the preceding `turn/started`. Where such a test relied on `tokensPerSecond` to keep a turn running long enough to queue input, switch it to the held turn.

Run: `cd packages/cli && bun x vitest --run test/app-server/turns.test.ts`
Expected: FAIL.

- [ ] **Step 6: Schemas and handlers**

```ts
const TurnInput = Obj({
	threadId: Str,
	expectedTurnId: Str,
	text: Str,
	images: Type.Optional(Type.Array(ImageInput)),
	clientMessageId: Type.Optional(ClientMessageId),
});
const QueueEntry = Obj({ id: Str, text: Str });
export const TurnQueue = Obj({ steering: Type.Array(QueueEntry), followUp: Type.Array(QueueEntry) });
export type TurnQueue = Static<typeof TurnQueue>;

// Add queue: TurnQueue to the existing thread/resume result; retain every history field.
"turn/steer": { params: TurnInput, result: Obj({ queueId: Str }) },
"turn/followUp": { params: TurnInput, result: Obj({ queueId: Str }) },
"turn/queue/remove": { params: Obj({ threadId: Str, queueId: Str }), result: Obj({ removed: Bool }) },
"turn/interrupt": { params: Obj({ threadId: Str, turnId: Type.Optional(Str) }), result: Empty },

// ServerNotifications
"turn/queue/updated": Obj({ threadId: Str, steering: Type.Array(QueueEntry), followUp: Type.Array(QueueEntry) }),
```

`threads.ts`:

```ts
"turn/steer": async ({ threadId, expectedTurnId, text, images, clientMessageId }) =>
	this.queue(threadId, "steer", expectedTurnId, text, images && (await Promise.all(images.map(readImageInput))), clientMessageId),
"turn/followUp": async ({ threadId, expectedTurnId, text, images, clientMessageId }) =>
	this.queue(threadId, "followUp", expectedTurnId, text, images && (await Promise.all(images.map(readImageInput))), clientMessageId),
"turn/interrupt": ({ threadId, turnId }) => this.interrupt(threadId, turnId).then(() => ({})),
"turn/queue/remove": async ({ threadId, queueId }) => ({ removed: this.get(threadId).session.removeQueued(queueId) }),
```

`queue(threadId, kind, expectedTurnId, text, images, clientMessageId)` checks, before anything else, `thread.mapper.currentTurnId() !== expectedTurnId` → `turnMismatch` (after the existing "no turn is running" check), generates `const queueId = randomUUID()`, and passes `queueId` and `clientMessageId` in the options it already gives `session.steer` / `session.followUp` (`threads.ts:769-786`). Its existing `preflightResult` check (`:777`) rejects input whose turn ended during preflight; change that error to `turnMismatch` as well. It returns `{ queueId }`. `interrupt(threadId, turnId?)` throws `turnMismatch` when `turnId` is given and is not the mapper's current turn, before aborting anything.

`item-mapper.ts`:

```ts
/** Identity-bearing queue snapshot; shares the same representation with resume and notifications. */
export function queueOf(session: AgentSession): TurnQueue {
	const entries = session.getQueueEntries();
	return {
		steering: entries.filter((e) => e.kind === "steer").map(({ id, text }) => ({ id, text })),
		followUp: entries.filter((e) => e.kind === "followUp").map(({ id, text }) => ({ id, text })),
	};
}

// In the event handler:
case "queue_update":
	this.thread.notify("turn/queue/updated", { threadId, ...queueOf(this.thread.session) });
	return;
```

In `threads.ts`'s existing `resume()` `commitOnSend` callback, add `queue: queueOf(thread.session)` to the response
in the same synchronous commit that validates history and establishes the subscription. Do not compute it before
that callback and do not send a separate initial queue notification: changes before the commit are in the
snapshot; changes afterward are notifications. Keep Task 6's usage and Task 8's warnings when those fields land.
Add protocol examples for the resume queue and identity-bearing queue notifications.

Update `architecture.md` §§4.4–4.6 to include required `queue: TurnQueue` on resume and this snapshot boundary.
Update `desktop-shell.md` §§7.1 and 9.4: initialize the composer queue from the resume response, including an empty
snapshot that clears stale renderer entries; buffer/replay subsequent queue notifications with the running-turn
snapshot. Queue state is live only and is not reconstructed from transcript history.

- [ ] **Step 7: Run the tests and the type check**

Run: `cd packages/agent && bun x vitest --run`
Run: `cd packages/cli && bun x vitest --run test/agent-session-queue.test.ts test/app-server/`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS.

- [ ] **Step 8: Commit** (if authorized)

Stage each changed test file by name (`git status` lists them), plus:

```bash
git add apps/desktop/docs/desktop-app/architecture.md apps/desktop/docs/desktop-app/desktop-shell.md packages/agent/src/agent.ts packages/agent/src/agent-loop.ts packages/agent/src/types.ts packages/agent/test/agent.test.ts packages/agent/test/agent-loop.test.ts packages/cli/src/core/agent-session.ts packages/cli/test/agent-session-queue.test.ts packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/src/app-server/threads.ts packages/cli/src/app-server/item-mapper.ts packages/cli/docs/app-server.schema.json packages/cli/test/app-server/turns.test.ts
git commit -m "feat(cli): bind steers and interrupts to their turn; queued input removable until delivery"
```

---

### Task 6: Token usage push and per-model thinking levels

**Files:**
- Modify: `packages/app-server-protocol/src/protocol.ts`, `test/protocol.test.ts`
- Modify: `packages/cli/src/app-server/item-mapper.ts`, `threads.ts`, `models.ts`
- Test: `packages/cli/test/app-server/turns.test.ts`, `thread-methods.test.ts`

**Interfaces:**
- Produces: `TokenUsage = { input, output, cacheRead, cacheWrite, cost, contextTokens?, contextWindow }`; notification `thread/tokenUsage/updated {threadId, turnId, usage}`; `thread/resume` result gains `usage: TokenUsage`; `model/list` models gain `thinkingLevels: ThinkingLevel[]`; `usageOf(session: AgentSession): TokenUsage` in `item-mapper.ts` (exported, used by `threads.ts`).

- [ ] **Step 1: Write the failing tests**

```ts
test("token usage is pushed after each reply and equals resume's usage (§4.3)", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("hello")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	const pushed = await a.waitFor("thread/tokenUsage/updated");
	await a.waitFor("turn/completed");
	const usage = pushed.usage as { output: number; contextWindow: number };
	expect(usage.output).toBeGreaterThan(0);
	expect(usage.contextWindow).toBeGreaterThan(0);
	const b = await connect();
	const resumed = await b.client.request("thread/resume", { threadId: thread.id });
	const { contextTokens: _a, ...pushedTotals } = pushed.usage as Record<string, number>;
	const { contextTokens: _b, ...resumedTotals } = resumed.usage as Record<string, number>;
	expect(resumedTotals).toEqual(pushedTotals);
	expect((pushed.usage as { contextTokens?: number }).contextTokens).toBeGreaterThan(0);
});
```

In `thread-methods.test.ts`:

```ts
test("model/list gives each model the thinking levels it accepts", async () => {
	const { connect } = await startServer();
	const a = await connect();
	const { models } = await a.client.request("model/list", {});
	const faux = models.find((m) => m.id === "faux-1")!;
	expect(faux.thinkingLevels[0]).toBe("off");
	expect(faux.thinkingLevels.length).toBeGreaterThan(1);
});
```

(The harness's faux model has `reasoning: true`. For a non-reasoning model, add a second faux model `{ id: "faux-plain", reasoning: false }` to the harness options and assert `["off"]`.)

Run: expected FAIL.

- [ ] **Step 2: Schemas**

```ts
export const TokenUsage = Obj({
	input: Num,
	output: Num,
	cacheRead: Num,
	cacheWrite: Num,
	cost: Num,
	contextTokens: Type.Optional(Num),
	contextWindow: Num,
});
// ServerNotifications
"thread/tokenUsage/updated": Obj({ threadId: Str, turnId: Str, usage: TokenUsage }),
```

`thread/resume` result adds `usage: TokenUsage`. `ModelInfo` adds `thinkingLevels: Type.Array(ThinkingLevel)`.

- [ ] **Step 3: Implement**

`item-mapper.ts`:

```ts
import { calculateContextTokens } from "@knightcode/ai";
import { addUsageToTotals, type UsageTotals } from "../core/usage-totals.ts";

/**
 * What the terminal footer shows: every entry's usage (what was billed) and the context size.
 * `pending` is an assistant message whose entry is not written yet: subscribers see `message_end`
 * before the session appends it (`agent-session.ts:1215-1233`), and no event follows the append.
 */
export function usageOf(session: AgentSession, pending?: AssistantMessage): TokenUsage {
	const stats = session.getSessionStats();
	const { input, output, cacheRead, cacheWrite } = stats.tokens;
	const totals: UsageTotals = { input, output, cacheRead, cacheWrite, cost: stats.cost };
	let contextTokens = session.getContextUsage()?.tokens ?? undefined;
	if (pending) {
		addUsageToTotals(totals, pending.usage); // the accumulation getSessionStats uses
		if (pending.stopReason !== "aborted" && pending.stopReason !== "error") {
			const tokens = calculateContextTokens(pending.usage);
			if (tokens > 0) contextTokens = tokens;
		}
	}
	return {
		input: totals.input,
		output: totals.output,
		cacheRead: totals.cacheRead,
		cacheWrite: totals.cacheWrite,
		cost: totals.cost,
		...(contextTokens === undefined ? {} : { contextTokens }),
		contextWindow: session.getContextUsage()?.contextWindow ?? session.model?.contextWindow ?? 0,
	};
}
```

`ContextUsage.tokens` is `number | null` (`core/extensions/types.ts:307`), hence the `?? undefined`.

At the end of `finishAssistant`, push with the message just finalized:

```ts
this.thread.notify("thread/tokenUsage/updated", {
	threadId: this.thread.id,
	turnId: turn.id,
	usage: usageOf(this.thread.session, message),
});
```

The pushed totals then equal what `getSessionStats()` reads once the entry is written. The pushed `contextTokens` is the reply's own context size; `thread/resume` reports `getContextUsage()`, which can add an estimate for messages after the last reply, so the test compares totals exactly and context loosely.

`threads.ts` `resume()` commit adds `usage: usageOf(thread.session)`.

`models.ts`: `thinkingLevels: getSupportedThinkingLevels(model) as ThinkingLevel[]` (import from `@knightcode/ai`; the protocol test already pins `ThinkingLevel` to the agent's union).

- [ ] **Step 4: Run, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS.

```bash
git add packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/src/app-server/item-mapper.ts packages/cli/src/app-server/threads.ts packages/cli/src/app-server/models.ts packages/cli/docs/app-server.schema.json packages/cli/test/app-server/turns.test.ts packages/cli/test/app-server/thread-methods.test.ts packages/cli/test/app-server/harness.ts
git commit -m "feat(cli): push token usage per reply and list each model's thinking levels"
```

---

### Task 7: Approvals with decisions, command prefixes, decline messages and reasons

**Files:**
- Create: `packages/cli/src/app-server/command-prefix.ts`
- Test: `packages/cli/test/app-server/command-prefix.test.ts` (new)
- Modify: `packages/app-server-protocol/src/protocol.ts`, `test/protocol.test.ts`
- Modify: `packages/cli/src/app-server/approvals.ts`, `loaded-thread.ts`
- Test: `packages/cli/test/app-server/approvals.test.ts`

**Interfaces:**
- Produces: `commandPrefix(command: string, shell: "bash" | "powershell"): string | undefined`; `matchesPrefix(command: string, prefix: string, shell: "bash" | "powershell"): boolean`; `LoadedThread.allowedPrefixes: Map<"bash" | "powershell", Set<string>>`; approval params gain `decisions`, `reason?`, `prefix?`; result becomes the union of §5.4; `DECLINED_REASON` stays the exact prefix of a decline-with-message reason so `toolCallStatus` still reads it as `declined`.

- [ ] **Step 1: Write the failing prefix tests**

The rule the tests pin: a prefix is offered only for a command form the code positively understands, and a later command is covered only if it would itself be offered exactly that prefix. A nested target that is itself a command dispatcher (a wrapper, an interpreter, or a multi-command tool such as `npm` or `git`) gets no prefix, because a prefix ending at the dispatcher would cover everything it can dispatch. Anything else fails closed. The cases below were run against this exact implementation (a standalone probe, 2026-10-14; rerun after review round 4 added the two-word rule for unlisted programs and exact matching) and all pass.

```ts
import { expect, test } from "vitest";
import { commandPrefix, matchesPrefix } from "../../src/app-server/command-prefix.ts";

type Shell = "bash" | "powershell";
const SHELLS: Shell[] = ["bash", "powershell"];

test("prefixes for recognised forms", () => {
	const offered: Array<[string, Shell, string]> = [
		["npm test -- --watch=false", "bash", "npm test"],
		["npm run build", "bash", "npm run build"],
		["git status", "bash", "git status"],
		["go run main.go", "bash", "go run main.go"],
		["python -m pytest -q", "bash", "python -m pytest"],
		["python scripts/check.py --fix", "bash", "python scripts/check.py"],
		["npx cowsay hi", "bash", "npx cowsay"],
		["uv run pytest -q", "bash", "uv run pytest"],
		["bun x prettier --check", "bash", "bun x prettier"],
		["docker ps", "bash", "docker ps"],
		["ls -la", "bash", "ls"],
		["echo one", "bash", "echo"],
		// A program on no list gets two words, never its name alone (review round 4).
		["./build.sh release", "bash", "./build.sh release"],
		["pip install requests", "bash", "pip install"],
		["poetry install", "bash", "poetry install"],
		["poetry run pytest -q", "bash", "poetry run pytest"],
		["mytool sync --all", "bash", "mytool sync"],
		["mytool run lint", "bash", "mytool run lint"],
		["Get-ChildItem -Force", "powershell", "Get-ChildItem"],
		["C:\\Tools\\python.exe check.py", "powershell", "C:\\Tools\\python.exe check.py"],
		["Npm Test", "powershell", "Npm Test"],
	];
	for (const [command, shell, prefix] of offered) expect(commandPrefix(command, shell), command).toBe(prefix);
});

test("no prefix, in either shell, for forms that chain, quote, dispatch or run other code", () => {
	const refused = [
		// Nested dispatchers (review round 3): the target is itself npm, git, python…
		"uv run npm test",
		"npx npm test",
		"uv run git status",
		"uv run npm exec node --eval=1",
		"npx npm exec node --eval=1",
		"bun x npm test",
		"npm exec node",
		"pnpm dlx tsx x.ts",
		"uv run python -c 1",
		"npm exec -- node -e 1",
		"python -m npm",
		"poetry run python -c 1",
		"pipx run npm",
		// Subcommands that run an arbitrary command inside something else.
		"docker run ubuntu",
		"docker exec c ls",
		"kubectl exec pod ls",
		"podman run alpine",
		// A flag where the subcommand or script belongs.
		"bun -e 1",
		"git -C . status",
		"cargo run --release",
		"npx -y cowsay",
		"python -c 1",
		"node -e 1",
		"bash -c ls",
		"sh -c ls",
		"cmd /c dir",
		"pwsh -Command Get-Date",
		"python.exe -c 1",
		// Wrappers, sourcing, environment overrides, incomplete forms.
		"source check.sh",
		". check.sh",
		"sudo ls",
		"env FOO=1 ls",
		"PATH=/tmp npm test",
		"xargs rm",
		"timeout 5 ls",
		"nohup ls",
		"wsl ls",
		"wsl rm -rf /",
		"wsl.exe ls",
		"setsid ls",
		"busybox sh",
		"npx",
		"npm run",
		"invoke-expression x",
		"IEX x",
		"Start-Process notepad",
		// Programs on no list (review round 4): no subcommand, a flag first, or a dispatcher or bare runner second.
		"pip -V",
		"./build.sh",
		"mytool",
		"mytool --flag",
		"mytool run",
		"mytool run npm",
		"mytool npm test",
		// Operators, quotes, script blocks.
		"npm test && rm -rf build",
		"npm test; ls",
		"a | b",
		'npm test "x"',
		"Invoke-Command {ls}",
	];
	for (const shell of SHELLS) for (const command of refused) expect(commandPrefix(command, shell), `${shell}: ${command}`).toBeUndefined();
	// Shell-specific characters.
	for (const command of ["echo `id`", "echo $(id)", "echo ${HOME}", "cat a > b", "rm *.log", "ls ~", "echo a\\ b", "find . -exec rm {} +"])
		expect(commandPrefix(command, "bash"), command).toBeUndefined();
	for (const command of ["Write-Output @args", "a `\nb", "Remove-Item 'x'", "$(Get-Date)"])
		expect(commandPrefix(command, "powershell"), command).toBeUndefined();
});

test("a prefix covers only commands that would be offered exactly that prefix themselves", () => {
	const cases: Array<[string, string, Shell, boolean]> = [
		["npm test -- --ci", "npm test", "bash", true],
		["npm testx", "npm test", "bash", false],
		["npm test; ls", "npm test", "bash", false],
		["npm run", "npm run build", "bash", false],
		["bun -e 1", "bun check.ts", "bash", false],
		["PATH=/tmp npm test", "npm test", "bash", false],
		["NPM test", "npm test", "bash", false],
		["NPM test", "npm test", "powershell", true],
		["python check.py -v", "python check.py", "bash", true],
		["python -c 1", "python check.py", "bash", false],
		["echo two words", "echo", "bash", true],
		["pip install -r requirements.txt", "pip install", "bash", true],
		["pip uninstall -y numpy", "pip install", "bash", false],
		["poetry run python -c 1", "poetry install", "bash", false],
	];
	for (const [command, prefix, shell, want] of cases) expect(matchesPrefix(command, prefix, shell), `${shell}: ${command}`).toBe(want);
	// Escalations the reviews reproduced, in both shells: even a stored prefix cannot cover them.
	for (const shell of SHELLS) {
		expect(matchesPrefix("uv run npm exec node --eval=1", "uv run npm", shell)).toBe(false);
		expect(matchesPrefix("npx npm exec node --eval=1", "npx npm", shell)).toBe(false);
		expect(matchesPrefix("uv run git push", "uv run git", shell)).toBe(false);
		// Review round 4: a one-word prefix for a program on no list covered every subcommand. A stored prefix
		// shorter than the command's own never matches, whatever produced it.
		expect(matchesPrefix("wsl rm -rf /", "wsl", shell)).toBe(false);
		expect(matchesPrefix("pip uninstall -y numpy", "pip", shell)).toBe(false);
		expect(matchesPrefix("poetry run python -c 1", "poetry", shell)).toBe(false);
	}
});
```

Run: `cd packages/cli && bun x vitest --run test/app-server/command-prefix.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 2: Implement `command-prefix.ts`**

```ts
/**
 * Command prefixes for "allow commands that start with …" (§5.4). Fails closed: a prefix is offered only for
 * a command form recognised below, and a later command is covered only if it would get the same prefix itself.
 * Anything unrecognised (an operator, an expansion, a quote, a flag where a subcommand belongs, a wrapper, an
 * interpreter running inline code, or a nested target that is itself a dispatcher) is approved whole or not at all.
 */

type Shell = "bash" | "powershell";

/** Characters that can chain, expand, quote, glob or redirect. Any of them anywhere: no prefix. */
const UNSAFE: Record<Shell, RegExp> = {
	bash: /[;&|`<>(){}[\]$\\'"*?!#~\n\r]/,
	powershell: /[;&|`<>(){}[\]$'"@\n\r]/,
};

/** Run another command given as arguments, or change how the shell runs one. Never a prefix. */
const WRAPPERS = new Set([
	"sudo", "doas", "su", "runas", "pkexec", "env", "xargs", "parallel", "find", "fd", "timeout", "nohup", "nice",
	"ionice", "time", "watch", "strace", "ltrace", "gdb", "exec", "eval", "command", "builtin", "source", ".", "trap",
	"ssh", "wsl", "chroot", "setsid", "stdbuf", "unbuffer", "flock", "nsenter", "unshare", "systemd-run", "busybox",
	"start", "call", "invoke-expression", "iex", "invoke-command", "icm", "start-process", "saps", "start-job",
	"invoke-item", "ii",
]);
/** Run code they are given. A prefix only together with a script file or module, never with a flag. */
const INTERPRETERS = new Set([
	"python", "python3", "py", "pythonw", "node", "deno", "ruby", "perl", "php", "lua", "bash", "sh", "zsh", "fish",
	"dash", "ksh", "pwsh", "powershell", "cmd", "npx", "bunx", "pnpx", "uvx", "tsx", "ts-node", "awk", "gawk", "sed",
	"osascript", "wscript", "cscript", "mshta", "rundll32", "regsvr32", "java",
]);
/** Tools whose second word is the real command (`npm test`, `git push`). */
const MULTI = new Set([
	"npm", "pnpm", "yarn", "bun", "git", "cargo", "go", "dotnet", "uv", "make", "docker", "podman", "kubectl", "gh",
	"pip", "pip3", "pipx", "poetry", "pdm", "hatch", "conda",
]);
/** Per tool, subcommands that run a named script or package binary: its name is part of the prefix (`npm run build`). */
const RUNNERS: Readonly<Record<string, ReadonlySet<string>>> = {
	npm: new Set(["run", "run-script", "exec", "x"]),
	pnpm: new Set(["run", "exec", "dlx"]),
	yarn: new Set(["run", "exec", "dlx"]),
	bun: new Set(["run", "x"]),
	uv: new Set(["run"]),
	go: new Set(["run"]),
	cargo: new Set(["run"]),
	pipx: new Set(["run"]),
	poetry: new Set(["run"]),
	pdm: new Set(["run"]),
	hatch: new Set(["run"]),
	conda: new Set(["run"]),
};
/** Per tool, subcommands that run an arbitrary command inside something else: never a prefix. */
const DISPATCHERS: Readonly<Record<string, ReadonlySet<string>>> = {
	docker: new Set(["run", "exec", "compose"]),
	podman: new Set(["run", "exec", "compose"]),
	kubectl: new Set(["exec", "run", "debug", "attach"]),
	dotnet: new Set(["exec"]),
	git: new Set(["submodule"]),
	gh: new Set(["extension", "alias"]),
};
/** Programs with no subcommands: the name alone is the prefix. A name missing here only narrows its prefix. */
const SIMPLE = new Set([
	"ls", "dir", "cat", "type", "echo", "pwd", "head", "tail", "wc", "grep", "rg", "diff", "stat", "file", "tree",
	"du", "df", "which", "whoami", "date", "uname", "get-childitem", "gci", "get-content", "gc", "get-item",
	"get-location", "select-string", "test-path", "get-date",
]);
/** Subcommands that, in a tool on no list, run a named target: the target is part of the prefix. */
const RUNNER_WORDS = new Set(["run", "exec", "x", "dlx"]);
const PYTHON = new Set(["python", "python3", "py"]);

const words = (command: string): string[] => command.trim().split(/\s+/).filter(Boolean);

/** How a word names a program: last path segment, lower case, without an executable suffix. */
const programName = (word: string): string =>
	(word.split(/[\\/]/).pop() ?? word).toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, "");

/** A program that can run other programs: a nested target like this makes a prefix cover too much. */
const dispatches = (word: string): boolean => {
	const name = programName(word);
	return WRAPPERS.has(name) || INTERPRETERS.has(name) || MULTI.has(name);
};

/** An argument that names something rather than configuring the program: not a flag, not an assignment. */
const isName = (word: string | undefined): word is string =>
	word !== undefined && !word.startsWith("-") && !word.startsWith("/") && !word.includes("=");

/** `first second third` when `third` names a target that is not itself a dispatcher; otherwise no prefix. */
const withTarget = (first: string, second: string, third: string | undefined): string | undefined =>
	isName(third) && !dispatches(third) ? `${first} ${second} ${third}` : undefined;

export function commandPrefix(command: string, shell: Shell): string | undefined {
	if (UNSAFE[shell].test(command)) return undefined;
	const [first, second, third] = words(command);
	if (first === undefined || first.includes("=")) return undefined; // FOO=1 cmd overrides the environment
	const name = programName(first);
	if (WRAPPERS.has(name)) return undefined;
	if (INTERPRETERS.has(name)) {
		if (PYTHON.has(name) && second === "-m") return withTarget(first, second, third);
		return isName(second) && !dispatches(second) ? `${first} ${second}` : undefined;
	}
	if (SIMPLE.has(name)) return first;
	// A multi-command tool, or a program on no list, which may be one: a flag before the subcommand (`git -C .`,
	// `bun -e`, `pip -V`) or no subcommand at all is a form this code does not understand.
	if (!isName(second) || dispatches(second)) return undefined;
	const sub = second.toLowerCase();
	if (MULTI.has(name)) {
		if (DISPATCHERS[name]?.has(sub)) return undefined;
		if (RUNNERS[name]?.has(sub)) return withTarget(first, second, third);
		return `${first} ${second}`;
	}
	// A program on no list gets its first two words, never its name alone: approving `pip install` must not
	// cover `pip uninstall`. A generic runner subcommand needs its target as well (`mytool run lint`).
	if (RUNNER_WORDS.has(sub)) return withTarget(first, second, third);
	return `${first} ${second}`;
}

/**
 * Covered only when the command would be offered exactly this prefix itself (case-insensitively in PowerShell).
 * Every rule that refuses to offer a prefix also refuses to match one, and a stored prefix shorter than the
 * command's own (`pip` against `pip uninstall`) never widens what an approval covers.
 */
export function matchesPrefix(command: string, prefix: string, shell: Shell): boolean {
	const own = commandPrefix(command, shell);
	if (own === undefined) return false;
	const have = words(own);
	const want = words(prefix);
	const same = (a: string, b: string) => (shell === "powershell" ? a.toLowerCase() === b.toLowerCase() : a === b);
	return have.length === want.length && have.every((word, i) => same(word, want[i]));
}
```

The lists are the residual risk and are stated as such in §5.4, but every gap in them now narrows a prefix rather than widening it: a program on no list gets its first two words, never its name alone, and a generic runner subcommand (`run`, `exec`, `x`, `dlx`) needs its target too, so approving `pip install` never covers `pip uninstall` and approving `wsl ls` is not offered at all. Only SIMPLE (programs with no subcommands) grants a one-word prefix, and a name missing from it only makes that program's prefix longer. A program that runs other code through an unlisted, non-generic subcommand (`mytool shell`) is the case that remains; adding a name to WRAPPERS, INTERPRETERS, MULTI or a DISPATCHERS entry is always safe. Matching is exact: a command is covered only when it would be offered that same prefix, so a shorter stored prefix never widens an approval. Approving a script runner (`npm run build`, `go run main.go`) trusts that script's current and future content, which the agent can edit; that is what the user approves by name.

Run: `cd packages/cli && bun x vitest --run test/app-server/command-prefix.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing approval tests**

Append to `approvals.test.ts`. The commands are `echo` variants so they run on every platform's `bash` tool; the prefix logic itself is covered for both shells in Step 1.

```ts
type Asked = { tool: string; prefix?: string; reason?: string; decisions: string[]; input?: { command?: string } };

async function askTurn(answer: (params: Asked) => ApprovalResult) {
	const server = await startServer();
	const a = await server.connect("desktop");
	const asked: Asked[] = [];
	a.client.onRequest("item/toolCall/requestApproval", async (params) => {
		asked.push(params as Asked);
		return answer(params as Asked);
	});
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd, approvalMode: "ask" });
	return { ...server, a, asked, thread };
}

test("bash offers a prefix, never acceptForSession; an allowed prefix skips later asks (§5.4)", async () => {
	const { a, faux, asked, thread } = await askTurn((p) =>
		p.prefix ? { decision: "acceptPrefixForSession" } : { decision: "decline" },
	);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo one" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo two words" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo three; echo four" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "run them" });
	await a.waitFor("turn/completed");
	expect(asked.map((p) => p.input?.command)).toEqual(["echo one", "echo three; echo four"]);
	expect(asked[0].prefix).toBe("echo");
	expect(asked[0].decisions).toEqual(["accept", "acceptPrefixForSession", "decline"]);
	expect(asked[1].prefix).toBeUndefined();
	expect(asked[1].decisions).toEqual(["accept", "decline"]);
	const [turn] = await a.readTurns(thread.id);
	const calls = turn.items.filter((i) => i.type === "toolCall") as { status: string }[];
	expect(calls.map((c) => c.status)).toEqual(["completed", "completed", "declined"]);
});

test("an answer the server did not offer is treated as decline", async () => {
	const { a, faux, thread } = await askTurn(() => ({ decision: "acceptForSession" }));
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo one" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "run it" });
	await a.waitFor("turn/completed");
	const [turn] = await a.readTurns(thread.id);
	expect((turn.items.find((i) => i.type === "toolCall") as { status: string }).status).toBe("declined");
});

test("a decline with a message blocks with that message", async () => {
	const { a, faux, thread } = await askTurn(() => ({ decision: "decline", message: "use pnpm" }));
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo npm" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "install" });
	await a.waitFor("turn/completed");
	const [turn] = await a.readTurns(thread.id);
	const call = turn.items.find((i) => i.type === "toolCall") as { status: string; output: { text?: string }[] };
	expect(call.status).toBe("declined");
	expect(call.output[0].text).toBe("The user rejected this tool call: use pnpm");
});

test("an edit outside the thread's cwd carries a reason; one inside does not", async () => {
	const { a, faux, asked, thread, cwd } = await askTurn(() => ({ decision: "decline" }));
	const elsewhere = mkdtempSync(join(tmpdir(), "kc-outside-"));
	writeFileSync(join(elsewhere, "x.txt"), "a\n");
	writeFileSync(join(cwd, "y.txt"), "a\n");
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("edit", { path: join(elsewhere, "x.txt"), edits: [{ oldText: "a", newText: "b" }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxToolCall("edit", { path: "y.txt", edits: [{ oldText: "a", newText: "b" }] })], {
			stopReason: "toolUse",
		}),
		// The edit tool expands `~`: outside the workspace although `resolve()` would place it inside.
		fauxAssistantMessage([fauxToolCall("edit", { path: "~/kc-never-written.txt", edits: [{ oldText: "a", newText: "b" }] })], {
			stopReason: "toolUse",
		}),
		// A file whose name starts with two dots is inside the workspace.
		fauxAssistantMessage([fauxToolCall("edit", { path: "..notes.txt", edits: [{ oldText: "a", newText: "b" }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "edit them" });
	await a.waitFor("turn/completed");
	expect(asked.map((p) => p.reason)).toEqual([
		"Writes outside this thread's workspace",
		undefined,
		"Writes outside this thread's workspace",
		undefined,
	]);
	expect(asked[1].decisions).toContain("acceptForSession");
});
```

Change the existing test "acceptForSession stops later requests for that tool" to use an extension-free non-shell tool that asks in `ask` mode (`edit` on a file in `cwd`, two calls, one request), since `bash` no longer offers `acceptForSession`. Import `ApprovalResult` from `@knightcode/app-server-protocol` and `mkdtempSync`, `tmpdir` at the top of the file.

Run: expected FAIL.

- [ ] **Step 4: Schemas**

```ts
const ApprovalDecisionKind = Type.Union([
	Type.Literal("accept"),
	Type.Literal("acceptForSession"),
	Type.Literal("acceptPrefixForSession"),
	Type.Literal("decline"),
]);
const ApprovalCommon = {
	threadId: Str,
	turnId: Str,
	itemId: Str,
	tool: Str,
	parentItemId: Type.Optional(Str),
	reason: Type.Optional(Str),
	prefix: Type.Optional(Str),
	decisions: Type.Array(ApprovalDecisionKind),
};
export const ApprovalResult = Type.Union([
	Obj({ decision: Type.Union([Type.Literal("accept"), Type.Literal("acceptForSession"), Type.Literal("cancel")]) }),
	Obj({ decision: Type.Literal("acceptPrefixForSession") }),
	Obj({ decision: Type.Literal("decline"), message: Type.Optional(Type.String({ maxLength: 4000 })) }),
]);
export type ApprovalResult = Static<typeof ApprovalResult>;

"item/toolCall/requestApproval": {
	params: Type.Union([Obj({ ...ApprovalCommon, input: Type.Unknown() }), Obj({ ...ApprovalCommon, inputRef: PayloadRef })]),
	result: ApprovalResult,
},
```

Remove the old `ApprovalDecision` export; `askApproval` returns `ApprovalResult`.

- [ ] **Step 5: Implement in the gate**

`loaded-thread.ts`: `readonly allowedPrefixes = new Map<"bash" | "powershell", Set<string>>()`.

`approvals.ts`:

```ts
const SHELLS = new Set(["bash", "powershell"]);
const OUTSIDE_WORKSPACE = "Writes outside this thread's workspace";

function shellOf(tool: string): "bash" | "powershell" | undefined {
	return SHELLS.has(tool) ? (tool as "bash" | "powershell") : undefined;
}

function commandOf(input: unknown): string | undefined {
	const command = typeof input === "object" && input !== null ? (input as { command?: unknown }).command : undefined;
	return typeof command === "string" ? command : undefined;
}

function reasonFor(tool: string, input: unknown, cwd: string): string | undefined {
	if (!EDIT_TOOLS.has(tool)) return undefined;
	const path = typeof input === "object" && input !== null ? (input as { path?: unknown }).path : undefined;
	if (typeof path !== "string") return undefined;
	// The resolver edit and write use (core/tools/path-utils.ts:48), so `~/.bashrc` resolves where the tool writes.
	const target = resolveToCwd(path, cwd);
	const inside = relative(cwd, target);
	return inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside) ? OUTSIDE_WORKSPACE : undefined;
}
```

Imports for these helpers: `isAbsolute`, `relative`, `sep` from `node:path`; `resolveToCwd` from `../core/tools/path-utils.ts`; `commandPrefix`, `matchesPrefix` from `./command-prefix.ts`.

In the `tool_call` handler, before asking:

```ts
const shell = shellOf(event.toolName);
const command = shell ? commandOf(event.input) : undefined;
if (shell && command && [...(thread.allowedPrefixes.get(shell) ?? [])].some((p) => matchesPrefix(command, p, shell)))
	return undefined;
const prefix = shell && command ? commandPrefix(command, shell) : undefined;
const reason = reasonFor(event.toolName, event.input, thread.session.sessionManager.getCwd());
const decisions = [
	"accept",
	...(shell ? [] : ["acceptForSession"]),
	...(prefix ? ["acceptPrefixForSession"] : []),
	"decline",
] as const;
```

Pass `decisions: [...decisions]`, `...(prefix ? { prefix } : {})`, `...(reason ? { reason } : {})` in the request params. After the answer:

```ts
const offered = new Set<string>(decisions);
const answer = result.decision === "cancel" || offered.has(result.decision) ? result : { decision: "decline" as const };
if (answer.decision === "acceptForSession") thread.allowed.add(event.toolName);
if (answer.decision === "acceptPrefixForSession" && shell && prefix) {
	const set = thread.allowedPrefixes.get(shell) ?? new Set<string>();
	set.add(prefix);
	thread.allowedPrefixes.set(shell, set);
}
if (answer.decision === "accept" || answer.decision === "acceptForSession" || answer.decision === "acceptPrefixForSession")
	return undefined;
const reasonText =
	answer.decision === "cancel"
		? CANCELLED_REASON
		: answer.decision === "decline" && answer.message
			? `${DECLINED_REASON}: ${answer.message}`
			: DECLINED_REASON;
return { block: true, reason: reasonText };
```

`thread.allowed` must never receive `bash` or `powershell` (an `acceptForSession` for them is not offered, and an unoffered answer became `decline` above). In `transcript.ts`, `toolCallStatus` reads a call as `declined` when its error text equals `DECLINED_REASON` or starts with `${DECLINED_REASON}: `.

- [ ] **Step 6: Run, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/command-prefix.test.ts test/app-server/approvals.test.ts test/app-server/`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS.

```bash
git add packages/cli/src/app-server/command-prefix.ts packages/cli/test/app-server/command-prefix.test.ts packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/src/app-server/approvals.ts packages/cli/src/app-server/loaded-thread.ts packages/cli/src/app-server/transcript.ts packages/cli/docs/app-server.schema.json packages/cli/test/app-server/approvals.test.ts
git commit -m "feat(cli): approve shell commands by prefix, decline with a message, explain risky edits"
```

---

### Task 8: Settings write with versions, settings errors, warnings, project trust

Four defects in the obvious design, each fixed here:

1. `FileSettingsStorage.withLock` takes the lock before reading only when the file exists (`settings-manager.ts:222-247`). For a missing file it reads "absent", runs the callback, then locks and writes what the callback computed. Two writers can both see "absent", both pass a compare-and-swap on version `none`, and the second overwrites the first.
2. A version computed by re-reading the file can be paired with settings the manager loaded earlier: the desktop loads A, the terminal writes B, the desktop answers `config/read` with A's settings and B's version, and an edit based on A passes the check. Settings, origins and version must come from one read.
3. A write outside the manager's write queue (`enqueueWrite`, `:590`) can be overtaken by a setter queued earlier, and a `reload()` that is not awaited lets a caller see old state after success.
4. Reading migrates legacy keys, but editing raw JSON does not: `{queueMode: "all"}` reads as `steeringMode: "all"`; deleting only `steeringMode` leaves `queueMode`, so the next read restores it. Writes must edit the migrated representation and remove known aliases even when a canonical value already exists.

Warnings have an ordering problem too. A thread's load-time diagnostics (its project settings failing to parse, an extension failing to import, skipped project resources) exist before `thread/start` or `thread/resume` subscribes the connection, so a notification would reach no one, or every connection if broadcast. They are returned in the response that caused the load instead.

**Files:**
- Modify: `packages/cli/src/core/settings-manager.ts`
- Test: `packages/cli/test/settings-manager-write-key.test.ts` (new)
- Modify: `packages/app-server-protocol/src/protocol.ts`, `test/protocol.test.ts`
- Modify: `packages/cli/src/app-server/models.ts` (config and trust handlers), `threads.ts`, `loaded-thread.ts`
- Test: `packages/cli/test/app-server/config.test.ts` (new)

**Interfaces:**
- Produces (core): `SettingsStorage.withLock` contract (below); `SettingsStorage.pathOf(scope): string | undefined`; `SettingsStorage.queueKey(scope): string`; `settingsFileKey(path): string`; `enqueueSettingsWrite(key, task): Promise<void>` (one write queue per settings file for the process, used by every manager); `SettingsManager.readScope(scope): ScopeSnapshot` with `ScopeSnapshot = { settings: Settings; version: string; error?: SettingsFileError }` and `SettingsFileError = { path?: string; message: string; line?: number; column?: number }`; `async SettingsManager.writeKey(scope, keyPath: string[], value: unknown, expectedVersion?: string): Promise<{ ok: boolean; version: string }>`; `deepMergeSettings` and `settingsOrigins(global: Settings, project: Settings): Record<string, "global" | "project">` exported.
- Produces (protocol): `Warning = { message, source: "settings" | "extension" | "trust" | "server", path?, line?, column? }`; `thread/start`, `thread/resume`, `thread/fork` results gain `warnings: Warning[]`; notification `warning: Warning & { threadId?: string }`; `config/read` result `{ settings, origins, versions: { global, project? }, errors: Warning[] }`; `config/write`; `project/trust/read`; `project/trust/set`.
- Produces (server): `LoadedThread.loadWarnings: Warning[]`.

- [ ] **Step 1: Core tests first**

Create `packages/cli/test/settings-manager-write-key.test.ts`:

```ts
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { FileSettingsStorage, SettingsManager } from "../src/core/settings-manager.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const fresh = () => {
	const agentDir = mkdtempSync(join(tmpdir(), "kc-settings-"));
	const cwd = mkdtempSync(join(tmpdir(), "kc-settings-cwd-"));
	return { agentDir, cwd, file: join(agentDir, "settings.json") };
};

test("a first write decides again under the lock when another writer created the file meanwhile", () => {
	const { agentDir, cwd, file } = fresh();
	const a = new FileSettingsStorage(cwd, agentDir);
	const b = new FileSettingsStorage(cwd, agentDir);
	let calls = 0;
	a.withLock("global", (current) => {
		calls++;
		// Between A's unlocked look at the missing file and its locked write, B creates the file.
		if (calls === 1) b.withLock("global", () => JSON.stringify({ theme: "light" }));
		// A compare-and-swap on "no file yet": only valid if the file is still missing.
		return current === undefined ? JSON.stringify({ defaultThinkingLevel: "high" }) : undefined;
	});
	expect(calls).toBe(2);
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "light" });
});

test("writeKey changes one key, keeps the others, and refuses a stale version", async () => {
	const { agentDir, cwd, file } = fresh();
	writeFileSync(file, JSON.stringify({ theme: "dark", defaultThinkingLevel: "low" }, null, 2));
	const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const before = settings.readScope("global").version;
	const written = await settings.writeKey("global", ["defaultThinkingLevel"], "high", before);
	expect(written.ok).toBe(true);
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "dark", defaultThinkingLevel: "high" });
	expect(settings.getSettings().defaultThinkingLevel).toBe("high"); // state refreshed before writeKey resolved
	expect(await settings.writeKey("global", ["theme"], "light", before)).toEqual({ ok: false, version: written.version });
	expect(JSON.parse(readFileSync(file, "utf8")).theme).toBe("dark");
	await settings.writeKey("global", ["theme"], null);
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ defaultThinkingLevel: "high" });
	await expect(settings.writeKey("global", ["__proto__", "x"], 1)).rejects.toThrow();
});

test.each([
	{ queueMode: "all" },
	{ queueMode: "all", steeringMode: "one-at-a-time" },
])("deleting a migrated steeringMode also removes its legacy alias: %j", async (initial) => {
	const { agentDir, cwd, file } = fresh();
	writeFileSync(file, JSON.stringify({ theme: "dark", ...initial }));
	const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const before = settings.readScope("global");
	expect(before.settings.steeringMode).toBe(initial.steeringMode ?? "all");
	const written = await settings.writeKey("global", ["steeringMode"], null, before.version);
	expect(written.ok).toBe(true);
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "dark" });
	expect(settings.readScope("global").settings).toEqual({ theme: "dark" });
	expect(settings.getSettings()).not.toHaveProperty("steeringMode");
});

test("two managers both creating the file with expectedVersion none: exactly one wins", async () => {
	const { agentDir, cwd, file } = fresh();
	const a = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const b = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const first = await a.writeKey("global", ["theme"], "light", "none");
	const second = await b.writeKey("global", ["defaultThinkingLevel"], "high", "none");
	expect([first.ok, second.ok]).toEqual([true, false]);
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "light" });
});

test("a setter queued before writeKey lands first, so a version read before it is stale", async () => {
	const { agentDir, cwd } = fresh();
	const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	const before = settings.readScope("global").version;
	settings.setDefaultThinkingLevel("low"); // queued, not yet written
	expect((await settings.writeKey("global", ["theme"], "light", before)).ok).toBe(false);
	const now = settings.readScope("global").version;
	expect((await settings.writeKey("global", ["theme"], "light", now)).ok).toBe(true);
	expect(settings.getSettings()).toMatchObject({ theme: "light", defaultThinkingLevel: "low" });
});

test("readScope takes settings and version from one read, and reports a parse error with its position", () => {
	const { agentDir, cwd, file } = fresh();
	const settings = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	writeFileSync(file, JSON.stringify({ theme: "light" })); // written after the manager loaded
	const snapshot = settings.readScope("global");
	expect(snapshot.settings.theme).toBe("light");
	expect(snapshot.version).toBe(sha(readFileSync(file, "utf8")));
	writeFileSync(file, '{\n  "theme": "light",\n  oops\n}');
	const broken = settings.readScope("global");
	expect(broken.error?.path).toBe(file);
	expect(broken.error?.message).toBeTruthy();
	// Line and column are set only when the runtime's JSON error reports a position (V8 does, JavaScriptCore
	// does not), so they are not asserted here; positionOf has its own unit test below.
	expect(broken.settings).toEqual({});
});
```

Also export `positionOf` (Step 3) and test it directly, independent of the runtime's message format:

```ts
import { positionOf } from "../src/core/settings-manager.ts";

test("positionOf turns a reported offset or line and column into a position", () => {
	const content = '{\n  "theme": "light",\n  oops\n}';
	expect(positionOf(content, new SyntaxError("Unexpected token o in JSON at position 25"))).toEqual({ line: 3, column: 4 });
	expect(positionOf(content, new SyntaxError("Expected ',' (line 3 column 3)"))).toEqual({ line: 3, column: 3 });
	expect(positionOf(content, new SyntaxError("JSON Parse error: Unexpected identifier"))).toEqual({});
});
```

Run: `cd packages/cli && bun x vitest --run test/settings-manager-write-key.test.ts`
Expected: FAIL — the first test sees `calls === 1` and B's file overwritten; `readScope` and `writeKey` do not exist.

- [ ] **Step 2: Lock-correct storage**

Replace `FileSettingsStorage.withLock`:

```ts
/**
 * Runs `fn` on the file's current content and writes what it returns. When the file exists, `fn` runs under
 * the lock. When it does not, `fn` first runs without it (taking a lock creates the directory, which a read
 * must not do); if that call returns content to write, the lock is taken and `fn` runs again on whatever is
 * there now, and only that second result is written. So `fn` must compute its result from `current` alone.
 */
withLock(scope: SettingsScope, fn: (current: string | undefined) => string | undefined): void {
	const path = scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
	const read = () => (existsSync(path) ? readFileSync(path, "utf-8") : undefined);
	let release: (() => void) | undefined;
	try {
		if (existsSync(path)) release = this.acquireLockSyncWithRetry(path);
		const current = read();
		let next = fn(current);
		if (next === undefined) return;
		if (!release) {
			const dir = dirname(path);
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			release = this.acquireLockSyncWithRetry(path);
			const now = read();
			if (now !== current) {
				next = fn(now);
				if (next === undefined) return;
			}
		}
		writeFileSync(path, next, "utf-8");
	} finally {
		release?.();
	}
}

pathOf(scope: SettingsScope): string | undefined {
	return scope === "global" ? this.globalSettingsPath : this.projectSettingsPath;
}
```

Add `pathOf(scope: SettingsScope): string | undefined` to the `SettingsStorage` interface (`:164`) and to `InMemorySettingsStorage` (returning `undefined`), and write the contract comment above on the interface. Audit the callers (`rg -n "withLock\(" packages/cli/src/core/settings-manager.ts`): `loadFromStorage` (`:370`) returns `undefined` so it runs once; `persistScopedSettings` (`:618`) computes from `current` and its own snapshot, so a second run is safe; `inMemory` (`:360`) ignores `current` and always writes, which is its intent. `auth-storage.ts` and `mcp/oauth.ts` use a different storage type and are out of scope.

- [ ] **Step 3: One-read snapshots and a queued, awaited writeKey**

In `SettingsManager`:

```ts
export interface SettingsFileError { path?: string; message: string; line?: number; column?: number }
export interface ScopeSnapshot { settings: Settings; version: string; error?: SettingsFileError }

const versionOf = (content: string | undefined) =>
	content === undefined ? "none" : createHash("sha256").update(content).digest("hex");

/** Line and column of a JSON parse error, from the message's position where the runtime reports one. */
export function positionOf(content: string, error: unknown): { line?: number; column?: number } {
	const message = error instanceof Error ? error.message : "";
	const lineColumn = /line (\d+) column (\d+)/i.exec(message);
	if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
	const position = /position (\d+)/i.exec(message);
	if (!position) return {};
	const before = content.slice(0, Number(position[1]));
	const lines = before.split("\n");
	return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Settings, version and parse error of one scope, all from the same read of the file. */
readScope(scope: SettingsScope): ScopeSnapshot {
	if (scope === "project" && !this.projectTrusted) return { settings: {}, version: "none" };
	let content: string | undefined;
	this.storage.withLock(scope, (current) => {
		content = current;
		return undefined;
	});
	const version = versionOf(content);
	if (!content) return { settings: {}, version };
	try {
		return { settings: SettingsManager.migrateSettings(JSON.parse(stripBom(content))), version };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { settings: {}, version, error: { path: this.storage.pathOf(scope), message, ...positionOf(content, error) } };
	}
}
```

The write queue today is per manager (`writeQueue`, `:282`; `enqueueWrite`, `:590`). Several managers write the same file in one process: the server's shared manager (`ctx.settings`), each loaded thread's manager, and any manager a handler builds. Per-manager queues order writes within a manager but not across them, so a `config/write` through one manager could land between two setters another manager queued earlier, and the later setter would then overwrite it. So the queue becomes one per settings file for the whole process, and every manager's writes go through it:

```ts
/** One write queue per settings file for the whole process, keyed by the file. */
const settingsWriteQueues = new Map<string, Promise<void>>();

/** The queue key of a settings file: its resolved path, case-folded on Windows. */
export function settingsFileKey(path: string): string {
	const resolved = resolvePath(path);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Run `task` after every write already queued for the same file, by any manager. The returned promise settles
 * with the task; a failing task does not stop the writes queued after it.
 */
export function enqueueSettingsWrite(key: string, task: () => void | Promise<void>): Promise<void> {
	const run = (settingsWriteQueues.get(key) ?? Promise.resolve()).then(task);
	const tail = run.catch(() => {});
	settingsWriteQueues.set(key, tail);
	void tail.then(() => {
		if (settingsWriteQueues.get(key) === tail) settingsWriteQueues.delete(key);
	});
	return run;
}
```

`SettingsStorage` gains `queueKey(scope: SettingsScope): string`: `FileSettingsStorage` returns `settingsFileKey(path)` for the scope's file; `InMemorySettingsStorage` returns a key unique to the instance and scope (`memory:${instanceId}:${scope}`, with a module-level counter for `instanceId`), so in-memory managers never share a queue.

`enqueueWrite` keeps its behaviour (trust check, task, `clearModifiedScope`, errors recorded) but runs through the shared queue, and the manager's own `writeQueue` becomes "all writes this manager queued", which `flush()` and `reload()` keep awaiting:

```ts
private track(run: Promise<void>, onError: (error: unknown) => void): void {
	const settled = run.catch(onError);
	this.writeQueue = Promise.all([this.writeQueue, settled]).then(() => {});
}

private enqueueWrite(scope: SettingsScope, task: () => void): void {
	const run = enqueueSettingsWrite(this.storage.queueKey(scope), () => {
		if (scope === "project") this.assertProjectTrustedForWrite();
		task();
		this.clearModifiedScope(scope);
	});
	this.track(run, (error) => this.recordError(scope, error));
}

/**
 * Set or delete (`value === null`) one dotted key in one file. Runs on the file's shared write queue, after every
 * write any manager queued for that file before it, as a compare-and-swap on the file's content hash inside the
 * storage lock; resolves only after this manager's state reflects the file.
 */
async writeKey(scope: SettingsScope, keyPath: string[], value: unknown, expectedVersion?: string): Promise<{ ok: boolean; version: string }> {
	if (keyPath.length === 0 || keyPath.some((k) => k === "__proto__" || k === "constructor" || k === "prototype"))
		throw new Error(`invalid settings key: ${keyPath.join(".")}`);
	if (scope === "project") this.assertProjectTrustedForWrite();
	let result = { ok: false, version: "none" };
	const run = enqueueSettingsWrite(this.storage.queueKey(scope), () => {
		this.storage.withLock(scope, (current) => {
			const version = versionOf(current);
			if (expectedVersion !== undefined && expectedVersion !== version) {
				result = { ok: false, version };
				return undefined;
			}
			const data = current
				? (SettingsManager.migrateSettings(JSON.parse(stripBom(current))) as Record<string, unknown>)
				: {};
			let node = data;
			for (const key of keyPath.slice(0, -1)) {
				const next = node[key];
				if (typeof next !== "object" || next === null || Array.isArray(next)) node[key] = {};
				node = node[key] as Record<string, unknown>;
			}
			const leaf = keyPath[keyPath.length - 1];
			if (value === null) delete node[leaf];
			else node[leaf] = value;
			const text = JSON.stringify(data, null, 2);
			result = { ok: true, version: versionOf(text) };
			return text;
		});
	});
	this.track(run, () => {}); // this caller sees the failure through `await run`
	await run;
	if (result.ok) await this.reload();
	return result;
}
```

Reads and writes must use the same migrated representation. `writeKey` migrates the parsed file under the lock,
after the content-hash comparison and before changing the key. Successful writes persist canonical keys; a stale
version or parse failure still writes nothing. Unrelated settings remain intact except for the existing migration
of known legacy keys.

Make alias removal unconditional in the existing `migrateSettings`: `queueMode` is removed whether or not
`steeringMode` already exists (the canonical value wins); `websockets` is removed whether or not `transport`
already exists (migrate its boolean value only when `transport` is absent). Retain the existing skills-object and
`retry.maxDelayMs` migrations, including removal of `retry.maxDelayMs` when the canonical provider value already
exists. This prevents a shadowed alias from resurrecting a deleted setting. Do not introduce a second alias map
or a separate write-only migration.

Extend the migration-delete test to `websockets → transport` and
`retry.maxDelayMs → retry.provider.maxRetryDelayMs`, both with and without a canonical value already present;
after deletion, neither the effective canonical leaf nor the legacy alias remains. Pin legacy skills-object
conversion followed by deletion of `enableSkillCommands` too. A normal set through `writeKey` preserves unrelated
keys and persists canonical names only. These tests run failing before the migration/write changes.

`withLock` may run the callback twice (Step 2); `result` is reassigned on each run, so it reports the run that decided. The queue orders writes within this process; another process (a terminal) is ordered by the storage lock, and the compare-and-swap refuses a write whose version a concurrent writer changed. Export `deepMergeSettings` (`:141`, add `export`) and add:

```ts
/** "project" for every leaf key the project file sets, else "global" for keys the global file sets. */
export function settingsOrigins(global: Settings, project: Settings): Record<string, "global" | "project"> {
	const origins: Record<string, "global" | "project"> = {};
	const walk = (value: unknown, prefix: string, origin: "global" | "project") => {
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			for (const [key, child] of Object.entries(value)) walk(child, prefix ? `${prefix}.${key}` : key, origin);
		} else if (prefix) origins[prefix] = origin;
	};
	walk(global, "", "global");
	walk(project, "", "project");
	return origins;
}
```

Run: `cd packages/cli && bun x vitest --run test/settings-manager-write-key.test.ts test/settings-manager.test.ts test/settings-manager-bug.test.ts`
Expected: PASS, including the existing settings tests.

- [ ] **Step 4: Protocol tests first**

Create `packages/cli/test/app-server/config.test.ts` (Task 0's harness serves `config/*` and `project/trust/*`):

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { enqueueSettingsWrite, settingsFileKey } from "../../src/core/settings-manager.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

test("config/write is compare-and-swap; config/read reports settings, origins and version of one read (§4.4)", async () => {
	const { agentDir, connect } = await startServer();
	const a = await connect();
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" })); // after the server loaded
	const read = await a.client.request("config/read", {});
	expect((read.settings as { theme?: string }).theme).toBe("dark"); // not the state loaded at startup
	const written = await a.client.request("config/write", {
		scope: "global",
		key: "defaultThinkingLevel",
		value: "high",
		expectedVersion: read.versions.global,
	});
	await expect(
		a.client.request("config/write", { scope: "global", key: "theme", value: "light", expectedVersion: read.versions.global }),
	).rejects.toMatchObject({ code: "configConflict" });
	const after = await a.client.request("config/read", {});
	expect(after.versions.global).toBe(written.version);
	expect(after.settings).toMatchObject({ theme: "dark", defaultThinkingLevel: "high" });
	expect(after.origins.defaultThinkingLevel).toBe("global");
	expect(after.errors).toEqual([]);
});

test("config/write is ordered after settings writes another manager queued before it (review round 3)", async () => {
	const { ctx, cwd, agentDir, threads, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	// A loaded thread builds its own SettingsManager (threads.ts:527); config/write's global path uses ctx.settings.
	// Two different managers of one file in one process: only the shared per-file queue orders them.
	const threadSettings = threads.get(thread.id).session.settingsManager;
	expect(threadSettings).not.toBe(ctx.settings);
	const before = (await a.client.request("config/read", {})).versions.global; // "none": no file yet
	// Hold the global file's queue so the order below is decided by queueing, not by timing.
	let open!: () => void;
	const gate = new Promise<void>((resolve) => (open = resolve));
	void enqueueSettingsWrite(settingsFileKey(join(agentDir, "settings.json")), () => gate);
	threadSettings.setTheme("dark"); // queued behind the gate, on the thread's manager
	threadSettings.setDefaultThinkingLevel("low"); // queued behind theme
	const write = a.client.request("config/write", {
		scope: "global",
		key: "defaultThinkingLevel",
		value: "high",
		expectedVersion: before,
	});
	open();
	// The write runs after both setters, so the version it was based on is stale; it must not land and then be
	// overwritten by an earlier-queued setter on the other manager, which is what per-manager queues allowed.
	await expect(write).rejects.toMatchObject({ code: "configConflict" });
	await threadSettings.flush();
	expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))).toMatchObject({
		theme: "dark",
		defaultThinkingLevel: "low",
	});
	const now = (await a.client.request("config/read", {})).versions.global;
	await a.client.request("config/write", { scope: "global", key: "defaultThinkingLevel", value: "high", expectedVersion: now });
	expect(ctx.settings.getSettings().defaultThinkingLevel).toBe("high"); // the server's own manager agrees
	await threadSettings.flush();
	expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).defaultThinkingLevel).toBe("high"); // no late setter overwrote it
});

The setters and the write must go through different managers (`session.settingsManager`, `agent-session.ts:428`,
against `ctx.settings`): with one manager on both sides, its own queue orders them and the test passes without the
shared per-file queue it exists to prove. To see it fail, make `enqueueWrite` use the manager's own `writeQueue`
again: the setters are then not behind the gate, land first, and the final `defaultThinkingLevel` assertions break.

test("config/write deletes a key exposed by migration, without it reappearing on config/read", async () => {
	const { agentDir, connect } = await startServer();
	const a = await connect();
	const file = join(agentDir, "settings.json");
	writeFileSync(file, JSON.stringify({ queueMode: "all", theme: "dark" }));
	const before = await a.client.request("config/read", {});
	expect(before.settings).toMatchObject({ steeringMode: "all" });
	await a.client.request("config/write", {
		scope: "global",
		key: "steeringMode",
		value: null,
		expectedVersion: before.versions.global,
	});
	const after = await a.client.request("config/read", {});
	expect(after.settings).toEqual({ theme: "dark" });
	expect(after.origins).not.toHaveProperty("steeringMode");
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "dark" });
});

test("config/read returns a settings file's parse error with its position", async () => {
	const { agentDir, connect } = await startServer();
	const a = await connect();
	writeFileSync(join(agentDir, "settings.json"), '{\n  "theme": \n}');
	const read = await a.client.request("config/read", {});
	expect(read.errors).toHaveLength(1);
	expect(read.errors[0]).toMatchObject({ source: "settings" });
	expect(String(read.errors[0].path)).toContain("settings.json");
});

test("project trust can be read and set; trusted project keys report their origin (§4.4)", async () => {
	const { cwd, connect } = await startServer();
	mkdirSync(join(cwd, ".knightcode"), { recursive: true });
	writeFileSync(join(cwd, ".knightcode", "settings.json"), JSON.stringify({ theme: "light" }));
	const a = await connect();
	expect(await a.client.request("project/trust/read", { cwd })).toEqual({ trusted: null, needsTrust: true });
	await a.client.request("project/trust/set", { cwd, trusted: true });
	expect(await a.client.request("project/trust/read", { cwd })).toEqual({ trusted: true, needsTrust: true });
	const read = await a.client.request("config/read", { cwd });
	expect(read.origins.theme).toBe("project");
});

test("load-time warnings come back in the response that loaded the thread, not as broadcasts", async () => {
	const { cwd, connect } = await startServer();
	mkdirSync(join(cwd, ".knightcode", "extensions"), { recursive: true });
	writeFileSync(join(cwd, ".knightcode", "extensions", "broken.ts"), "export default ( =>");
	const a = await connect("desktop");
	const other = await connect("desktop");
	await a.client.request("project/trust/set", { cwd, trusted: true });
	const { thread, warnings } = await a.client.request("thread/start", { cwd });
	expect(warnings.some((w) => w.source === "extension" && String(w.path).includes("broken.ts"))).toBe(true);
	const resumed = await other.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.warnings).toEqual(warnings); // a second window sees the same load diagnostics
	expect(other.notifications.some((n) => n.method === "warning")).toBe(false);
});

test("an undecided project's skipped resources are reported as a trust warning", async () => {
	const { cwd, connect } = await startServer();
	mkdirSync(join(cwd, ".knightcode"), { recursive: true });
	writeFileSync(join(cwd, ".knightcode", "settings.json"), JSON.stringify({ theme: "light" }));
	const a = await connect();
	const { warnings } = await a.client.request("thread/start", { cwd });
	expect(warnings.filter((w) => w.source === "trust")).toHaveLength(1);
});
```

Confirm that a `.knightcode/settings.json` and a `.knightcode/extensions/*.ts` make `hasTrustRequiringProjectResources` true and that a trusted project's broken extension surfaces in `resourceLoader.getExtensions().errors` (`LoadExtensionsResult`, `core/extensions/types.ts:2278`); if the project extension directory name differs, use the one `package-manager.ts` resolves.

Run: `cd packages/cli && bun x vitest --run test/app-server/config.test.ts`
Expected: FAIL.

- [ ] **Step 5: Schemas**

```ts
export const Warning = Obj({
	message: Str,
	source: Type.Union([Type.Literal("settings"), Type.Literal("extension"), Type.Literal("trust"), Type.Literal("server")]),
	path: Type.Optional(Str),
	line: Type.Optional(Num),
	column: Type.Optional(Num),
});
export type Warning = Static<typeof Warning>;
const SettingsScope = Type.Union([Type.Literal("global"), Type.Literal("project")]);

"config/read": {
	params: Obj({ cwd: Type.Optional(Str) }),
	result: Obj({
		settings: Type.Unknown(),
		origins: Type.Record(Str, SettingsScope),
		versions: Obj({ global: Str, project: Type.Optional(Str) }),
		errors: Type.Array(Warning),
	}),
},
"config/write": {
	params: Obj({
		scope: SettingsScope,
		cwd: Type.Optional(Str),
		key: Type.String({ minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9_-]+(\\.[A-Za-z0-9_-]+)*$" }),
		value: Type.Unknown(),
		expectedVersion: Type.Optional(Str),
	}),
	result: Obj({ version: Str }),
},
"project/trust/read": { params: Obj({ cwd: Str }), result: Obj({ trusted: Type.Union([Bool, Type.Null()]), needsTrust: Bool }) },
"project/trust/set": { params: Obj({ cwd: Str, trusted: Bool }), result: Empty },
```

`thread/start` and `thread/fork` results become `Obj({ thread: Thread, warnings: Type.Array(Warning) })`; `thread/resume`'s result object gains `warnings: Type.Array(Warning)`. Task 1's `warning` notification schema becomes `Type.Intersect([Warning, Obj({ threadId: Type.Optional(Str) })])`, or the same fields written out flat if the protocol's `additionalProperties: false` objects do not intersect cleanly in TypeBox (write them out flat; that is the safe choice).

- [ ] **Step 6: Handlers and warning routing**

`models.ts`:

```ts
"config/read": async ({ cwd }) => {
	const resolved = cwd === undefined ? undefined : resolvePath(cwd);
	const trusted =
		resolved !== undefined &&
		(!hasTrustRequiringProjectResources(resolved) || new ProjectTrustStore(ctx.agentDir).get(resolved) === true);
	const manager = SettingsManager.create(resolved ?? process.cwd(), ctx.agentDir, { projectTrusted: trusted });
	const global = manager.readScope("global");
	const project = resolved !== undefined ? manager.readScope("project") : undefined;
	const toWarning = (e: SettingsFileError): Warning => ({ source: "settings", ...e });
	return {
		settings: deepMergeSettings(global.settings, project?.settings ?? {}),
		origins: settingsOrigins(global.settings, project?.settings ?? {}),
		versions: { global: global.version, ...(project ? { project: project.version } : {}) },
		errors: [global.error, project?.error].filter((e): e is SettingsFileError => e !== undefined).map(toWarning),
	};
},
```

A fresh manager per read is deliberate: `ctx.settings` holds state from startup, and the point of this method is the file as it is now; reading needs no queue. Writing does. `config/write`:

- `scope: "global"`: `await ctx.settings.writeKey("global", key.split("."), value, expectedVersion)`. The server's shared manager owns the global file in this process, and `writeKey` reloads it before resolving, so the server's own settings agree with the file when the response is sent.
- `scope: "project"`: requires `cwd` (`invalidParams` otherwise) and a trusted project (`invalidParams` with `data.reason: "untrusted"`); a manager for that cwd (`SettingsManager.create(resolved, ctx.agentDir, { projectTrusted: true })`) calls `writeKey("project", …)`. Its writes share the project file's queue with every loaded thread's manager for that project, because the queue is keyed by file (Step 3).
- `ok: false` throws `AppServerError("configConflict", "settings changed since they were read", { version })`.

`project/trust/read` and `project/trust/set` as before (`ProjectTrustStore.get`/`.set`, `hasTrustRequiringProjectResources`).

Warning routing (§4.5), implemented in `threads.ts` and `loaded-thread.ts`:

- At the end of `load()`, before the thread is published as ready, collect `thread.loadWarnings`:
  - the thread's settings manager `drainErrors()` as `source: "settings"` with `path` and the position from `positionOf`;
  - `session.resourceLoader.getExtensions().errors` (`{path, error}`) as `source: "extension"`, and its `warnings` (`{path, warning}`) likewise;
  - extension runner errors reported through `bind()`'s `onError` while loading, as `source: "extension"`;
  - when `hasTrustRequiringProjectResources(projectCwd)` and the trust store has no decision, one `source: "trust"` warning: "This project has its own extensions and settings; they were not loaded. Trust the project to use them."
- `thread/start` and `thread/fork` return `{ thread, warnings: thread.loadWarnings }`; `thread/resume` returns `warnings: thread.loadWarnings` in its commit, for a thread that was already loaded too, so every window that opens the thread sees them once.
- After load, `bind()`'s `onError` sends `warning` with `threadId` to that thread's subscribers only (`thread.notify`), and still prints to stderr.
- A warning with no thread (none is produced in this plan; reserved for server-level problems) goes to every connection (`ctx.broadcast`).

- [ ] **Step 7: Run, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/settings-manager-write-key.test.ts test/settings-manager.test.ts test/app-server/config.test.ts test/app-server/`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS.

```bash
git add packages/cli/src/core/settings-manager.ts packages/cli/test/settings-manager-write-key.test.ts packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/src/app-server/models.ts packages/cli/src/app-server/threads.ts packages/cli/src/app-server/loaded-thread.ts packages/cli/docs/app-server.schema.json packages/cli/test/app-server/config.test.ts
git commit -m "feat(cli): race-safe versioned settings writes, settings errors, load warnings and project trust over the protocol"
```

---

### Task 9: `file/search`

The composer sends a search per keystroke, so the method has to stay bounded in processes, memory and state under that load:

- **Superseding answers at once.** A newer request with the same `searchId` makes the older one answer `{ files: [], truncated: false }` immediately, even while the listing it waits for is still running.
- **Processes are bounded, not just cache entries.** At most 2 listings run at once; further listings queue for a slot, and a slot is handed directly to the next queued listing, so the count never exceeds 2. A listing that nobody waits for any more (its searches were all superseded) is aborted, which stops its `fd`. A listing evicted from the cache while still running keeps serving the searches already waiting for it (the slot limit bounds processes); it is just not reused. Shutdown aborts every listing.
- **Memory is bounded.** Listings are cached per cwd for 10 s, at most 8 cwds (least recently used evicted). A listing keeps at most 200,000 paths, requesting one extra from `fd` to detect count truncation independently of exit status. It reads at most 32 MiB of output; past that it stops `fd` and keeps the complete lines read so far, up to the path cap.
- **Partial output is explicit.** A result says `truncated: true` when its list may be incomplete: the path-count or output-byte cap was reached (so the bounded listing is cached), or `fd` exited with an error after printing some files (for example an unreadable subdirectory; served, never cached, so the next search tries again). `fd` exiting with an error and no output is a failure: `internal` with its stderr, never cached. `fd` missing answers `toolMissing`. A 15-second timeout stops `fd` and counts as a failure.

The listing logic and the subprocess handling below were run as standalone probes (2026-10-14): the concurrency cases under Bun, the subprocess cases under Bun 1.3.3 and Node 24.

**Files:**
- Create: `packages/cli/src/app-server/file-search.ts`
- Modify: `packages/app-server-protocol/src/protocol.ts`, `test/protocol.test.ts`, `packages/cli/src/app-server/threads.ts` (handler; `closeAll` closes it)
- Test: `packages/cli/test/app-server/file-search.test.ts` (new), `packages/cli/test/app-server/fixtures/fake-fd.mjs` (new)

**Interfaces:**
- Produces: `fuzzyScore(query: string, path: string): { score: number; indices: number[] } | undefined`; `type Listing = { files: string[]; truncated: boolean; cacheable: boolean }`; `type ListFiles = (cwd: string, signal: AbortSignal) => Promise<Listing>`; `createFdLister(options?: { command?: string; args?: string[]; maxStdoutBytes?: number; maxFiles?: number }): ListFiles` (default: `fd` via `ensureTool`); `class FileSearch { constructor(options?: { list?: ListFiles; now?: () => number }); search(params): Promise<ResultOf<"file/search">>; close(): void }`; `file/search` result `{ files, truncated }`.

- [ ] **Step 1: Tests first**

`packages/cli/test/app-server/fixtures/fake-fd.mjs`, a stand-in for `fd` run as a real subprocess (plain JavaScript, so `process.execPath` runs it under Bun and Node alike):

```js
// Stand-in for fd: argv = exit code, repeat count, ...lines, "--", then fd's own flags (ignored).
const args = process.argv.slice(2);
const code = Number(args[0]);
const repeat = Number(args[1]);
const lines = args.slice(2, args.indexOf("--"));
let out = "";
for (let i = 0; i < repeat; i++) for (const line of lines) out += `${line}\n`;
process.stdout.write(out);
if (code !== 0) process.stderr.write("fd: some/dir: Permission denied (os error 13)\n");
process.exitCode = code;
```

`packages/cli/test/app-server/file-search.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createFdLister, FileSearch, fuzzyScore, type ListFiles, type Listing } from "../../src/app-server/file-search.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

const tick = () => new Promise((resolve) => setImmediate(resolve));
const fakeFd = (code: number, repeat: number, lines: string[], maxStdoutBytes?: number) =>
	createFdLister({
		command: process.execPath,
		args: [join(import.meta.dirname, "fixtures/fake-fd.mjs"), String(code), String(repeat), ...lines, "--"],
		maxStdoutBytes,
	});

/** Listings the test finishes by hand; records each call's signal and the most that ran at once. */
function manualListings() {
	const calls: Array<{ cwd: string; signal: AbortSignal; done: boolean; finish: (files: string[]) => void }> = [];
	let active = 0;
	let maxActive = 0;
	const list: ListFiles = (cwd, signal) =>
		new Promise<Listing>((resolve, reject) => {
			active++;
			maxActive = Math.max(maxActive, active);
			const call = {
				cwd,
				signal,
				done: false,
				finish: (files: string[]) => {
					if (call.done) return;
					call.done = true;
					active--;
					resolve({ files, truncated: false, cacheable: true });
				},
			};
			signal.addEventListener(
				"abort",
				() => {
					if (call.done) return;
					call.done = true;
					active--;
					reject(signal.reason);
				},
				{ once: true },
			);
			calls.push(call);
		});
	return { list, calls, maxActive: () => maxActive };
}

test("fuzzyScore prefers contiguous and basename matches", () => {
	const a = fuzzyScore("thrds", "packages/cli/src/app-server/threads.ts")!;
	const b = fuzzyScore("thrds", "packages/cli/src/app-server/transcript-handler-ids.ts");
	expect(a.indices).toHaveLength(5);
	expect(b === undefined || a.score > b.score).toBe(true);
	expect(fuzzyScore("xyz", "threads.ts")).toBeUndefined();
});

test("file/search lists project files with the real fd, respects .gitignore, and ranks (§4.4)", async () => {
	const { cwd, connect } = await startServer();
	execFileSync("git", ["init", "-q"], { cwd });
	mkdirSync(join(cwd, "src", "app-server"), { recursive: true });
	writeFileSync(join(cwd, "src", "app-server", "threads.ts"), "");
	writeFileSync(join(cwd, "src", "app-server", "transcript.ts"), "");
	mkdirSync(join(cwd, "dist"));
	writeFileSync(join(cwd, "dist", "threads.js"), "");
	writeFileSync(join(cwd, ".gitignore"), "dist/\n");
	const a = await connect();
	const result = await a.client.request("file/search", { cwd, query: "thrds" });
	expect(result.truncated).toBe(false);
	expect(result.files[0].path).toBe("src/app-server/threads.ts");
	expect(result.files.some((f) => f.path.startsWith("dist"))).toBe(false);
});

test("real fd reports count truncation even with exit code zero; exactly at the cap is complete", async () => {
	const { cwd } = await startServer();
	const dir = join(cwd, "count-cap");
	mkdirSync(dir);
	writeFileSync(join(dir, "a.ts"), "");
	writeFileSync(join(dir, "b.ts"), "");
	const list = createFdLister({ maxFiles: 2 });
	const signal = new AbortController().signal;
	const exact = await list(dir, signal);
	expect(exact.files.sort()).toEqual(["a.ts", "b.ts"]);
	expect(exact).toMatchObject({ truncated: false, cacheable: true });
	writeFileSync(join(dir, "c.ts"), "");
	const capped = await list(dir, signal);
	expect(capped.files).toHaveLength(2); // ordering is fd's, not a fixture assumption
	expect(capped).toMatchObject({ truncated: true, cacheable: true });
	const search = new FileSearch({ list: async () => capped });
	expect((await search.search({ cwd: dir, query: ".ts" })).truncated).toBe(true);
	search.close();
});

test("a superseded search answers at once, and its listing is aborted when nobody else waits for it", async () => {
	const m = manualListings();
	const search = new FileSearch({ list: m.list });
	const older = search.search({ cwd: "/x", query: "a", searchId: "s" });
	const newer = search.search({ cwd: "/y", query: "b", searchId: "s" });
	expect(await older).toEqual({ files: [], truncated: false }); // although /x's listing never finished
	expect(m.calls[0].signal.aborted).toBe(true); // nobody waits for /x any more: its process is stopped
	m.calls[1].finish(["src/b.ts"]);
	expect((await newer).files.map((f) => f.path)).toEqual(["src/b.ts"]);
});

test("ten cwds at once: at most 2 listings run, and listings evicted while pending still serve their waiters", async () => {
	const m = manualListings();
	const search = new FileSearch({ list: m.list });
	const searches = Array.from({ length: 10 }, (_, i) => search.search({ cwd: `/c${i}`, query: "a" }));
	await tick();
	expect(m.calls).toHaveLength(2); // the rest queue for a slot
	// Ten cwds against a cache of 8: /c0 and /c1 were evicted while running, but their searches still wait on them.
	expect(m.calls[0].signal.aborted).toBe(false);
	expect(m.calls[1].signal.aborted).toBe(false);
	for (let round = 0; round < 50 && (m.calls.length < 10 || m.calls.some((c) => !c.done)); round++) {
		for (const c of m.calls) c.finish(["a.ts"]);
		await tick();
	}
	const results = await Promise.all(searches);
	expect(results.every((r) => r.files.length === 1)).toBe(true);
	expect(m.calls).toHaveLength(10);
	expect(m.maxActive()).toBeLessThanOrEqual(2);
});

test("a listing aborted while queued for a slot does not swallow the next hand-off", async () => {
	const m = manualListings();
	const search = new FileSearch({ list: m.list });
	const a = search.search({ cwd: "/a", query: "a", searchId: "s1" });
	const b = search.search({ cwd: "/b", query: "a", searchId: "s2" });
	const c = search.search({ cwd: "/c", query: "a", searchId: "s3" }); // queued for a slot
	const d = search.search({ cwd: "/d", query: "a" }); // queued behind it
	const e = search.search({ cwd: "/e", query: "a", searchId: "s3" }); // supersedes c: its queued listing aborts
	expect((await c).files).toEqual([]);
	m.calls[0].finish(["a.ts"]); // frees a slot: it must reach d or e, not c's withdrawn waiter
	await tick();
	await tick();
	expect(m.calls).toHaveLength(3);
	for (let round = 0; round < 20; round++) {
		for (const call of m.calls) call.finish(["a.ts"]);
		await tick();
	}
	await Promise.all([a, b, d, e]);
	expect(m.maxActive()).toBeLessThanOrEqual(2);
});

test("listings are cached briefly; failed and partial listings are not", async () => {
	let now = 0;
	let calls = 0;
	const outcomes: Array<() => Promise<Listing>> = [
		async () => {
			throw new Error("fd exited 2: boom");
		},
		async () => ({ files: ["a.ts"], truncated: true, cacheable: false }), // partial: served, not cached
		async () => ({ files: ["a.ts"], truncated: false, cacheable: true }),
	];
	const search = new FileSearch({ now: () => now, list: () => outcomes[Math.min(calls++, 2)]() });
	await expect(search.search({ cwd: "/p", query: "a" })).rejects.toMatchObject({ code: "internal" });
	expect((await search.search({ cwd: "/p", query: "a" })).truncated).toBe(true);
	await search.search({ cwd: "/p", query: "a" }); // listed again: neither earlier outcome was cached
	await search.search({ cwd: "/p", query: "a" }); // cached
	expect(calls).toBe(3);
	now += 10_001;
	await search.search({ cwd: "/p", query: "a" }); // expired
	expect(calls).toBe(4);
});

test("the fd lister: errors with no output fail, errors after output are partial, the byte cap truncates, abort stops it", async () => {
	const signal = new AbortController().signal;
	await expect(fakeFd(2, 1, [])("/", signal)).rejects.toThrow(/exited 2/);
	expect(await fakeFd(1, 1, ["a.ts", "b.ts"])("/", signal)).toEqual({ files: ["a.ts", "b.ts"], truncated: true, cacheable: false });
	expect(await fakeFd(0, 1, ["a.ts"])("/", signal)).toEqual({ files: ["a.ts"], truncated: false, cacheable: true });
	const capped = await fakeFd(0, 10_000, ["src/some/long/path/name.ts"], 1024)("/", signal);
	expect(capped.truncated && capped.cacheable).toBe(true);
	expect(capped.files.join("\n").length).toBeLessThanOrEqual(1024);
	expect(capped.files.length > 0 && capped.files.every((f) => f === "src/some/long/path/name.ts")).toBe(true); // complete lines only
	const aborter = new AbortController();
	const pending = fakeFd(0, 1, ["a.ts"])("/", aborter.signal);
	aborter.abort(new Error("stop"));
	await expect(pending).rejects.toThrow("stop");
});

test("close() ends running listings; later searches answer shuttingDown", async () => {
	const m = manualListings();
	const search = new FileSearch({ list: m.list });
	const running = search.search({ cwd: "/p", query: "a" });
	await tick(); // the listing has started
	search.close();
	await expect(running).rejects.toMatchObject({ code: "shuttingDown" });
	expect(m.calls[0].signal.aborted).toBe(true);
	await expect(search.search({ cwd: "/p", query: "a" })).rejects.toMatchObject({ code: "shuttingDown" });
});
```

Run: `cd packages/cli && bun x vitest --run test/app-server/file-search.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

```ts
/** `file/search` (§4.4): fuzzy file names for `@` mentions, over the same listing the `find` tool uses (fd). */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ParamsOf, ResultOf } from "@knightcode/app-server-protocol";
import { ensureTool } from "../utils/tools-manager.ts";
import { resolvePath } from "../utils/paths.ts";
import { AppServerError } from "./errors.ts";

const LISTING_TTL_MS = 10_000;
const MAX_CACHED_CWDS = 8;
const MAX_ACTIVE_LISTINGS = 2;
const MAX_FILES = 200_000;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const LISTING_TIMEOUT_MS = 15_000;
const STDERR_TAIL_BYTES = 4096;

/** `truncated`: the list may be incomplete. `cacheable`: serving it again within the TTL is correct. */
export type Listing = { files: string[]; truncated: boolean; cacheable: boolean };
export type ListFiles = (cwd: string, signal: AbortSignal) => Promise<Listing>;

export function fuzzyScore(query: string, path: string): { score: number; indices: number[] } | undefined {
	const q = query.toLowerCase();
	const p = path.toLowerCase();
	const base = p.lastIndexOf("/") + 1;
	const indices: number[] = [];
	let score = 0;
	let from = 0;
	for (const char of q) {
		const at = p.indexOf(char, from);
		if (at === -1) return undefined;
		const previous = indices.at(-1);
		score += previous !== undefined && at === previous + 1 ? 5 : 1;
		if (at >= base) score += 2;
		if (at === 0 || "/._-".includes(p[at - 1])) score += 3;
		indices.push(at);
		from = at + 1;
	}
	return { score: score - path.length / 100, indices };
}

function insideGitRepo(dir: string): boolean {
	for (let current = dir; ; current = dirname(current)) {
		if (existsSync(join(current, ".git"))) return true;
		if (dirname(current) === current) return false;
	}
}

/**
 * Lists files with fd, gitignore-aware as the `find` tool runs it (`core/tools/find.ts:182-197`). `command` and
 * `args` replace the fd binary (tests run a stand-in); byte and path limits bound retained output.
 */
export function createFdLister(
	options: { command?: string; args?: string[]; maxStdoutBytes?: number; maxFiles?: number } = {},
): ListFiles {
	const maxBytes = options.maxStdoutBytes ?? MAX_STDOUT_BYTES;
	const maxFiles = options.maxFiles ?? MAX_FILES;
	return async (cwd, signal) => {
		const command = options.command ?? (await ensureTool("fd"));
		if (!command) throw new AppServerError("toolMissing", "fd is not available");
		const fdArgs = [
			"--type",
			"f",
			"--color=never",
			"--hidden",
			"--exclude",
			".git",
			"--max-results",
			String(maxFiles + 1),
		];
		if (!insideGitRepo(cwd)) fdArgs.push("--no-require-git");
		return new Promise<Listing>((resolve, reject) => {
			const child = spawn(command, [...(options.args ?? []), ...fdArgs], {
				cwd,
				signal,
				timeout: LISTING_TIMEOUT_MS,
				windowsHide: true,
			});
			const chunks: Buffer[] = [];
			let bytes = 0;
			let capped = false;
			let err = "";
			child.stdout.on("data", (chunk: Buffer) => {
				if (capped) return;
				const room = maxBytes - bytes;
				chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
				bytes += Math.min(chunk.length, room);
				if (chunk.length >= room) {
					capped = true;
					child.kill(); // stop fd: everything kept so far is within the cap
				}
			});
			child.stderr.setEncoding("utf8").on("data", (chunk: string) => (err = (err + chunk).slice(-STDERR_TAIL_BYTES)));
			// spawn reports an abort as its own AbortError; the caller should see the abort's reason.
			child.on("error", (error) => reject(signal.aborted ? signal.reason : error));
			child.on("close", (code, killedBy) => {
				if (signal.aborted) return reject(signal.reason);
				const text = Buffer.concat(chunks).toString("utf8");
				// Only complete lines: a cut at the byte cap or a crash can leave half a path at the end.
				const listed = text
					.slice(0, text.lastIndexOf("\n") + 1)
					.split("\n")
					.filter(Boolean)
					.map((line) => line.replaceAll("\\", "/"));
				const countCapped = listed.length > maxFiles;
				const files = listed.slice(0, maxFiles);
				if (capped) return resolve({ files, truncated: true, cacheable: true });
				if (killedBy) return reject(new Error(`fd was stopped after ${LISTING_TIMEOUT_MS / 1000} s`));
				if (code === 0) return resolve({ files, truncated: countCapped, cacheable: true });
				// An error after some output (an unreadable subdirectory) is a partial listing: served, never cached.
				if (files.length > 0) return resolve({ files, truncated: true, cacheable: false });
				reject(new Error(`fd exited ${code}: ${err.trim()}`));
			});
		});
	};
}

interface Entry {
	at: number;
	listing: Promise<Listing>;
	controller: AbortController;
	waiters: number;
	settled: boolean;
}

export class FileSearch {
	private readonly list: ListFiles;
	private readonly now: () => number;
	/** Insertion order is recency: a hit is re-inserted, the first key is the least recently used. */
	private readonly cache = new Map<string, Entry>();
	private readonly latest = new Map<string, { ticket: number; supersede: () => void }>();
	private readonly shutdown = new AbortController();
	/** Running listings; a released slot passes straight to the next queued listing, so this never exceeds the limit. */
	private active = 0;
	private readonly slots: Array<() => void> = [];
	private sequence = 0;

	constructor(options: { list?: ListFiles; now?: () => number } = {}) {
		this.list = options.list ?? createFdLister();
		this.now = options.now ?? Date.now;
	}

	private acquire(signal: AbortSignal): Promise<void> {
		if (this.active < MAX_ACTIVE_LISTINGS) {
			this.active++;
			return Promise.resolve();
		}
		return new Promise<void>((resolve, reject) => {
			// A waiter that gives up leaves the queue, so it can never absorb a hand-off.
			const onAbort = () => {
				const index = this.slots.indexOf(wake);
				if (index !== -1) this.slots.splice(index, 1);
				reject(signal.reason);
			};
			const wake = () => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			};
			this.slots.push(wake);
			signal.addEventListener("abort", onAbort, { once: true });
		});
	}

	private release(): void {
		const next = this.slots.shift();
		if (next) next(); // the slot passes on: `active` stays the same
		else this.active--;
	}

	private async withSlot<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
		await this.acquire(signal);
		try {
			signal.throwIfAborted();
			return await run();
		} finally {
			this.release();
		}
	}

	/** Out of the cache; a running listing nobody waits for is aborted, which stops its process. */
	private drop(cwd: string, entry: Entry): void {
		if (this.cache.get(cwd) === entry) this.cache.delete(cwd);
		if (!entry.settled && entry.waiters === 0) entry.controller.abort(new AppServerError("internal", "listing no longer needed"));
	}

	private entryFor(cwd: string): Entry {
		const cached = this.cache.get(cwd);
		if (cached) {
			this.cache.delete(cwd);
			if (this.now() - cached.at < LISTING_TTL_MS) {
				this.cache.set(cwd, cached);
				return cached;
			}
			this.drop(cwd, cached);
		}
		const controller = new AbortController();
		const signal = AbortSignal.any([controller.signal, this.shutdown.signal]);
		const entry: Entry = {
			at: this.now(),
			listing: Promise.resolve({ files: [], truncated: false, cacheable: false }),
			controller,
			waiters: 0,
			settled: false,
		};
		entry.listing = this.withSlot(signal, () => this.list(cwd, signal)).then(
			(listing) => {
				entry.settled = true;
				if (!listing.cacheable && this.cache.get(cwd) === entry) this.cache.delete(cwd);
				return listing;
			},
			(error: unknown) => {
				entry.settled = true;
				if (this.cache.get(cwd) === entry) this.cache.delete(cwd); // a failed listing is never served again
				throw error;
			},
		);
		entry.listing.catch(() => {});
		this.cache.set(cwd, entry);
		while (this.cache.size > MAX_CACHED_CWDS) {
			const [oldest, evicted] = this.cache.entries().next().value!;
			this.drop(oldest, evicted);
		}
		return entry;
	}

	async search(params: ParamsOf<"file/search">): Promise<ResultOf<"file/search">> {
		if (this.shutdown.signal.aborted) throw new AppServerError("shuttingDown", "the app server is shutting down");
		const ticket = ++this.sequence;
		let superseded!: () => void;
		const supersededPromise = new Promise<"superseded">((resolve) => (superseded = () => resolve("superseded")));
		if (params.searchId !== undefined) {
			this.latest.get(params.searchId)?.supersede();
			this.latest.set(params.searchId, { ticket, supersede: superseded });
		}
		const cwd = resolvePath(params.cwd);
		const entry = this.entryFor(cwd);
		entry.waiters++;
		try {
			const outcome = await Promise.race([entry.listing, supersededPromise]);
			if (outcome === "superseded") return { files: [], truncated: false };
			const ranked = outcome.files
				.flatMap((path) => {
					const match = fuzzyScore(params.query, path);
					return match ? [{ path, ...match }] : [];
				})
				.sort((a, b) => b.score - a.score)
				.slice(0, params.limit ?? 50);
			return { files: ranked, truncated: outcome.truncated };
		} catch (error) {
			if (this.shutdown.signal.aborted) throw new AppServerError("shuttingDown", "the app server is shutting down");
			if (error instanceof AppServerError) throw error;
			throw new AppServerError("internal", `file search failed: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			entry.waiters--;
			if (entry.waiters === 0 && !entry.settled) this.drop(cwd, entry);
			if (params.searchId !== undefined && this.latest.get(params.searchId)?.ticket === ticket) this.latest.delete(params.searchId);
		}
	}

	/** Abort every listing, running or queued, and refuse new searches. */
	close(): void {
		this.shutdown.abort(new AppServerError("shuttingDown", "the app server is shutting down"));
		this.cache.clear();
		for (const entry of this.latest.values()) entry.supersede();
		this.latest.clear();
	}
}
```

Every listing's signal combines its own controller with the shutdown signal (`AbortSignal.any`, available in the Bun and Node versions the repo runs), so `close()` aborts all of them, running or queued. The cache key is the resolved cwd, so in tests `/p` resolves to an absolute path on Windows; the tests compare only call counts and signals.

Schema:

```ts
"file/search": {
	params: Obj({
		cwd: Str,
		query: Type.String({ minLength: 1, maxLength: 256 }),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		searchId: Type.Optional(Type.String({ maxLength: 128 })),
	}),
	result: Obj({
		files: Type.Array(Obj({ path: Str, score: Num, indices: Type.Array(Num) })),
		truncated: Bool,
	}),
},
```

`ThreadManager` owns one `FileSearch`, adds the handler, and calls `fileSearch.close()` in `closeAll()` before awaiting payload shutdown.

Count truncation is independent of byte truncation: `fd` may stop successfully at `--max-results`, so exit code 0
alone never proves a complete listing. Keep the extra path only for detection, never return it. The existing
`file/search` result propagates `Listing.truncated`; the desktop picker must show "Some files may be missing"
whenever it is true. No change to ranking or the per-search result `limit` is needed.

- [ ] **Step 3: Run, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/file-search.test.ts`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS.

```bash
git add packages/cli/src/app-server/file-search.ts packages/cli/test/app-server/file-search.test.ts packages/cli/test/app-server/fixtures/fake-fd.mjs packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/src/app-server/threads.ts packages/cli/docs/app-server.schema.json
git commit -m "feat(cli): bounded fuzzy file search for composer mentions"
```

---

### Task 10: `thread/delete` and the unsubscribe status

Deletion destroys data, so every refusal must leave the thread, its run, its subscribers and its file exactly as they were, and the file removed must be the one checked. The traps, each reproduced in review:

- Checking "busy" and then awaiting anything (a file lookup) lets a turn start in between; the delete then interrupts it.
- `transition()` (`threads.ts:416`) takes the loaded thread out of the ready map before its callback runs, so throwing inside the callback leaves the thread unreachable unless it is put back.
- Disposing before re-checking the file lets a concurrent unarchive win and still lose the thread's subscribers.
- `SessionManager.open` can repair or migrate the transcript that is about to be deleted.

So the order is:

1. **Preflight, nothing disturbed:** find the file; refuse a missing one (`threadNotFound`) or an unarchived one (`threadNotArchived`).
2. **The fence.** Synchronously, with no await before `transition()`'s own synchronous first step: refuse a busy thread (`turnInProgress`), then enter the closing transition. From that synchronous step on, the id is out of the ready map and every new request for it waits (§5.6), so nothing can start on it. A `turn/start` that had already looked the thread up but had not yet registered its start is cancelled when the thread is disposed, exactly as during an unload; it was never admitted.
3. **Inside the fence, before disturbing anything:** find the file again and repeat the archived check (an unarchive that ran before the fence moved it), and re-check busy (a load that finished inside the fence). Any refusal puts the thread back into the ready map, untouched and still subscribed.
4. **Then:** dispose the thread if loaded, take the file's lock directly and exclusively (`acquireSessionLock(file, undefined, true)`, which neither reads nor writes the transcript), verify the header id, require the lock not lost, unlink, release. Another process's lock answers `threadLockedElsewhere` (possible only when this process did not have the thread loaded, since a loaded thread holds the lock); a hard-linked file answers `archiveConflict` as loading does (§5.8); an unlink failure keeps the file, releases the lock and answers `internal`.

**Files:**
- Modify: `packages/app-server-protocol/src/protocol.ts`, `test/protocol.test.ts`
- Modify: `packages/cli/src/app-server/threads.ts`, `session-files.ts`
- Test: `packages/cli/test/app-server/thread-delete.test.ts` (new), `thread-methods.test.ts`

**Interfaces:**
- Produces: `thread/delete {threadId} → {}`; notification `thread/deleted {threadId}` (sidebar: every connection); `thread/unsubscribe` result `{status: "unsubscribed" | "notSubscribed"}`; `ThreadManager.delete(threadId): Promise<void>`; `ThreadManager.unsubscribe(threadId, by): boolean`; `SessionFileIndex.forget(id: string): void`.
- Consumes: Task 0's `createHeldTurn`; the existing `createGate` (`fixtures/gate-extension.ts`) and `fixtures/hold-session.ts`.

- [ ] **Step 1: Tests first**

Create `packages/cli/test/app-server/thread-delete.test.ts`:

```ts
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createGate } from "./fixtures/gate-extension.ts";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { cleanupServers, startServer, waitForLine } from "./harness.ts";

afterEach(async () => {
	vi.restoreAllMocks();
	await cleanupServers();
});

type Server = Awaited<ReturnType<typeof startServer>>;

async function archivedThread(server: Server) {
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	await a.client.request("thread/archive", { threadId: thread.id }); // also unloads it
	const file = await server.threads.files.find(thread.id);
	return { a, thread, file: file! };
}

/** Block the next `files.find` call until the returned function is called: delete's preflight lookup. */
function gateNextFind(server: Server): () => void {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => (open = resolve));
	const original = server.threads.files.find.bind(server.threads.files);
	vi.spyOn(server.threads.files, "find").mockImplementationOnce(async (id: string) => {
		await opened;
		return original(id);
	});
	return open;
}

const notLoadedFor = (c: { notifications: Array<{ method: string; params: Record<string, unknown> }> }, id: string) =>
	c.notifications.some(
		(n) => n.method === "thread/status/changed" && n.params.threadId === id && (n.params.status as { type: string }).type === "notLoaded",
	);

test("an archived thread is deleted and every connection is told", async () => {
	const server = await startServer();
	const { a, thread, file } = await archivedThread(server);
	const b = await server.connect();
	await a.client.request("thread/delete", { threadId: thread.id });
	await b.waitFor("thread/deleted", (p) => p.threadId === thread.id);
	expect(existsSync(file)).toBe(false);
	expect(existsSync(`${file}.lock-owner`)).toBe(false);
	await expect(a.client.request("thread/read", { threadId: thread.id })).rejects.toMatchObject({ code: "threadNotFound" });
	expect((await a.client.request("thread/list", { archived: true })).threads.some((t) => t.id === thread.id)).toBe(false);
});

test("an unarchived thread, running or idle, is refused without being touched", async () => {
	const held = createHeldTurn();
	const { cwd, faux, connect } = await startServer({ extraExtensions: [{ name: "held-turn", factory: held.extension }] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("finished normally")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	try {
		await held.entered;
		await expect(a.client.request("thread/delete", { threadId: thread.id })).rejects.toMatchObject({ code: "threadNotArchived" });
	} finally {
		held.release();
	}
	expect(((await a.waitFor("turn/completed")).turn as { status: string }).status).toBe("completed");
	await expect(a.client.request("thread/delete", { threadId: thread.id })).rejects.toMatchObject({ code: "threadNotArchived" });
	expect(notLoadedFor(a, thread.id)).toBe(false);
	expect(await a.client.request("thread/unsubscribe", { threadId: thread.id })).toEqual({ status: "unsubscribed" });
});

test("a turn that starts while delete looks up the file makes delete refuse; the run and subscription survive", async () => {
	const held = createHeldTurn();
	const server = await startServer({ extraExtensions: [{ name: "held-turn", factory: held.extension }] });
	const { a, thread } = await archivedThread(server);
	await a.client.request("thread/resume", { threadId: thread.id }); // loaded again, archived
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("finished normally")]),
	]);
	const openFind = gateNextFind(server);
	const deleted = a.client.request("thread/delete", { threadId: thread.id }); // parked in its preflight lookup
	await a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	try {
		await held.entered;
		openFind();
		await expect(deleted).rejects.toMatchObject({ code: "turnInProgress" });
	} finally {
		held.release();
	}
	expect(((await a.waitFor("turn/completed")).turn as { status: string }).status).toBe("completed");
	expect(server.threads.loadedCount()).toBe(1);
	expect(await a.client.request("thread/unsubscribe", { threadId: thread.id })).toEqual({ status: "unsubscribed" });
});

test("an unarchive that completes while delete looks up the file makes delete refuse; the file stays", async () => {
	const server = await startServer();
	const { a, thread } = await archivedThread(server);
	const openFind = gateNextFind(server);
	const deleted = a.client.request("thread/delete", { threadId: thread.id }); // preflight sees the archived path
	await a.client.request("thread/unarchive", { threadId: thread.id }); // its own lookups are not gated
	openFind();
	await expect(deleted).rejects.toMatchObject({ code: "threadNotArchived" });
	const file = await server.threads.files.find(thread.id);
	expect(file && existsSync(file)).toBe(true);
	expect((await a.client.request("thread/read", { threadId: thread.id })).thread.archived).toBe(false);
});

test("a delete that arrives while a resume of the same thread is loading waits for it, then deletes", async () => {
	const gate = createGate(1); // let thread/start's load through, park the resume's
	const server = await startServer({ extraExtensions: [{ name: "gate", factory: gate.extension }] });
	const { a, thread, file } = await archivedThread(server);
	const resumed = a.client.request("thread/resume", { threadId: thread.id });
	await gate.entered;
	const deleted = a.client.request("thread/delete", { threadId: thread.id });
	gate.open();
	await deleted;
	await expect(resumed).rejects.toMatchObject({ code: "threadNotFound" });
	expect(existsSync(file)).toBe(false);
});

test("another process holding the file: threadLockedElsewhere, file kept", async () => {
	const server = await startServer();
	const { a, thread, file } = await archivedThread(server);
	const holder = spawn(process.execPath, [join(import.meta.dirname, "fixtures/hold-session.ts"), file], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	try {
		await waitForLine(holder.stdout!, "locked");
		await expect(a.client.request("thread/delete", { threadId: thread.id })).rejects.toMatchObject({
			code: "threadLockedElsewhere",
		});
		expect(existsSync(file)).toBe(true);
	} finally {
		holder.stdin!.end();
		await once(holder, "exit");
	}
});

// Making unlink fail portably needs a read-only directory, which neither Windows nor root honours.
test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("an unlink failure keeps the file and releases the lock", async () => {
	const server = await startServer();
	const { a, thread, file } = await archivedThread(server);
	chmodSync(dirname(file), 0o500);
	try {
		await expect(a.client.request("thread/delete", { threadId: thread.id })).rejects.toMatchObject({ code: "internal" });
		expect(existsSync(file)).toBe(true);
	} finally {
		chmodSync(dirname(file), 0o700);
	}
	await a.client.request("thread/delete", { threadId: thread.id }); // the lock was released: a retry succeeds
	expect(existsSync(file)).toBe(false);
});
```

Confirm `createGate`'s `skip` counts loads across the server (it is per extension instance, and the extension loads once per thread load): `thread/start` is the first load and the resume the second. `files` on `ThreadManager` is `readonly files: SessionFileIndex` (public), so the spy needs no production hook.

In `thread-methods.test.ts`:

```ts
test("thread/unsubscribe says whether the connection was subscribed", async () => {
	const { cwd, connect } = await startServer();
	const a = await connect();
	const b = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	expect(await a.client.request("thread/unsubscribe", { threadId: thread.id })).toEqual({ status: "unsubscribed" });
	expect(await b.client.request("thread/unsubscribe", { threadId: thread.id })).toEqual({ status: "notSubscribed" });
});
```

Run: `cd packages/cli && bun x vitest --run test/app-server/thread-delete.test.ts test/app-server/thread-methods.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

Schemas: `"thread/delete": { params: ThreadId, result: Empty }`; `"thread/unsubscribe": { params: ThreadId, result: Obj({ status: Type.Union([Type.Literal("unsubscribed"), Type.Literal("notSubscribed")]) }) }`; notification `"thread/deleted": Obj({ threadId: Str })`.

`session-files.ts`, beside `remember` (`:54`): `forget(id: string): void` deleting the id from the same map `remember` writes.

`threads.ts`:

```ts
async delete(threadId: string): Promise<void> {
	this.assertOpen();
	// 1. Preflight: refusals here disturb nothing.
	const found = await this.files.find(threadId);
	if (!found) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
	if (!isArchivedPath(found)) throw new AppServerError("threadNotArchived", "archive the thread before deleting it");
	// 2. The fence: no await between this check and transition()'s synchronous removal of the thread from the
	// ready map. After that, new requests for the id wait for this transition (§5.6).
	if (this.threads.get(threadId)?.busy) throw new AppServerError("turnInProgress", "interrupt the turn first");
	await this.transition(threadId, async (thread) => {
		// A refusal puts the thread back exactly as it was: never disposed, still subscribed.
		const refuse = (error: AppServerError): never => {
			if (thread && thread.state === "ready") this.threads.set(threadId, thread);
			throw error;
		};
		// 3. Re-check inside the fence, before disturbing anything.
		const file = await this.files.find(threadId);
		if (!file) refuse(new AppServerError("threadNotFound", `no saved thread: ${threadId}`));
		if (!isArchivedPath(file!)) refuse(new AppServerError("threadNotArchived", "archive the thread before deleting it"));
		if (thread?.busy) refuse(new AppServerError("turnInProgress", "interrupt the turn first"));
		// 4. Only now: unload, take the file, verify, remove.
		if (thread) {
			await thread.dispose();
			this.ctx.broadcast("thread/status/changed", { threadId, status: { type: "notLoaded" } });
		}
		let lock: SessionLock;
		try {
			// Exclusive and file-level only: nothing reads, repairs or migrates the transcript being deleted.
			lock = acquireSessionLock(file!, undefined, true);
		} catch (error) {
			if (error instanceof SessionLockedError)
				throw new AppServerError("threadLockedElsewhere", "the thread is open in another KnightCode process");
			if (error instanceof SessionHardLinkedError)
				throw new AppServerError("archiveConflict", error.message, { reason: "duplicateLinks", paths: await this.files.findAll(threadId) });
			throw error;
		}
		try {
			if (readSessionHeaderForDiscovery(file!)?.id !== threadId)
				throw new AppServerError("threadNotFound", `the file no longer holds thread ${threadId}`);
			if (lock.lost) throw new AppServerError("threadLockedElsewhere", "another process took the file");
			await unlink(file!).catch((error: unknown) => {
				throw new AppServerError("internal", `could not delete ${file}: ${(error as Error).message}`);
			});
		} finally {
			lock.release();
		}
		this.files.forget(threadId);
	});
	this.ctx.broadcast("thread/deleted", { threadId });
}
```

Import `acquireSessionLock`, `SessionLock` from `../core/session-lock.ts` and `unlink` from `node:fs/promises`. `lock.release()` removes the `.lock-owner` token beside the file (`session-lock.ts:225-239`). Putting the thread back with `this.threads.set` is safe inside the transition: requests that arrived meanwhile are waiting on the `closing` entry and, once it settles, find the thread in the ready map again through `ensureLoaded` (§5.6). The `thread/status/changed` value is Task 2's object form.

`unsubscribe(threadId, by): boolean` returns whether `by` was in `thread.subscribers` (false when the thread is not loaded); the handler maps `true` to `{ status: "unsubscribed" }` and `false` to `{ status: "notSubscribed" }`. `thread/deleted` goes through `ctx.broadcast`, so every connection sees it.

- [ ] **Step 3: Run, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/thread-delete.test.ts test/app-server/thread-methods.test.ts test/app-server/`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS.

```bash
git add packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/src/app-server/threads.ts packages/cli/src/app-server/session-files.ts packages/cli/docs/app-server.schema.json packages/cli/test/app-server/thread-delete.test.ts packages/cli/test/app-server/thread-methods.test.ts
git commit -m "feat(cli): delete archived threads safely and report unsubscribe status"
```

---

### Task 11: The listing index

The index (§5.10) is a cache: whatever is in it, the listing must come out right and bounded, and a failure to write it must never fail the listing.

- **Validated, not trusted.** Cached entries and newly scanned summaries must meet the same schema: unknown properties are rejected, dates must be finite before ISO serialization and parse afterward, and titles are at most 201 code points (200 plus `titleOf`'s ellipsis). A bad cached entry is rescanned. A malformed transcript is skipped individually and cached as `session: null` until its size or mtime changes; it never aborts the other rows. Records returned to the caller are built from named fields only.
- **Bounded.** An entry stores the listing summary only, never message text. The index file itself is refused unread (as if missing) when it is larger than 16 MiB, about 50,000 entries.
- **Fork identity from headers, cached.** When a forked transcript is scanned, its parent's id is read from the parent's header (`parentIdOf`, Task 2) and stored as `forkedFromId`. A warm listing serves it from the index and opens no transcript, parents included. Renaming or archiving the parent later does not change the cached id.
- **Every open counted.** `listWithIndex` reports each transcript it scans and each parent header it reads through `onRead`, so tests and the benchmark can assert a warm listing opens nothing. The server keeps running totals in `server/diagnostics`.
- **Best effort.** Writing the index happens after the listing is computed; any failure is ignored and the temporary file removed.
- **Bounded concurrency across the whole listing:** directories are listed one after another, each with at most 64 transcripts open (`MAX_CONCURRENT_SESSION_DISCOVERY_LOADS`, `session-manager.ts:943`).

**Files:**
- Create: `packages/cli/src/app-server/listing-index.ts`
- Modify: `packages/cli/src/core/session-manager.ts` (export `buildSessionInfo`, `mapWithConcurrency`, `sessionCwdMatches`)
- Modify: `packages/cli/src/app-server/threads.ts` (`list()` uses the index; read counters), `packages/app-server-protocol/src/protocol.ts` and `test/protocol.test.ts` (two `server/diagnostics` fields)
- Test: `packages/cli/test/app-server/listing-index.test.ts` (new), `server.test.ts`

**Interfaces:**
- Produces: `listWithIndex(dir: string, options?: { onRead?: (path: string, kind: "transcript" | "parentHeader", bytes: number) => void }): Promise<IndexedSession[]>` where `IndexedSession = { path: string; id: string; cwd: string; title: string; forkedFromId?: string; created: Date; modified: Date; messageCount: number }`; `MAX_INDEX_BYTES = 16 * 1024 * 1024`; `server/diagnostics` gains `listingFilesOpened: number` and `listingBytesScanned: number` (running totals since start).
- Consumes: Task 2's `parentIdOf`; `titleOf` (`loaded-thread.ts:14`).

- [ ] **Step 1: Tests first**

```ts
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test } from "vitest";
import { listWithIndex, MAX_INDEX_BYTES } from "../../src/app-server/listing-index.ts";

const userEntry = (text: string, parentId: string | null = null) => ({
	type: "message",
	id: randomUUID().slice(0, 8),
	parentId,
	timestamp: new Date().toISOString(),
	message: { role: "user", content: text, timestamp: Date.now() },
});

/** One real session file (header line, then one user entry; CURRENT_SESSION_VERSION is 3). */
function writeSession(dir: string, options: { text?: string; parentSession?: string; name?: string; timestamp?: string } = {}) {
	const id = randomUUID();
	const file = join(dir, options.name ?? `2026-10-14T00-00-00-000Z_${id}.jsonl`);
	const header = {
		type: "session",
		version: 3,
		id,
		timestamp: options.timestamp ?? new Date().toISOString(),
		cwd: dir,
		...(options.parentSession ? { parentSession: options.parentSession } : {}),
	};
	writeFileSync(file, `${JSON.stringify(header)}\n${JSON.stringify(userEntry(options.text ?? "hello"))}\n`);
	return { id, file };
}
const writeSessions = (dir: string, count: number) => Array.from({ length: count }, (_, i) => writeSession(dir, { text: `hello ${i}` }).file);
const indexPath = (dir: string) => join(dir, ".thread-index.json");
const indexOf = (dir: string) => JSON.parse(readFileSync(indexPath(dir), "utf8"));
const listCounting = async (dir: string) => {
	const opened: string[] = [];
	const listed = await listWithIndex(dir, { onRead: (path) => opened.push(path) });
	return { listed, opened };
};

test("a second listing opens nothing, forks and non-sessions included; an appended session is rescanned alone (§5.10)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-index-"));
	const files = writeSessions(dir, 20);
	const parent = writeSession(dir, { text: "parent" });
	writeSession(dir, { text: "fork", parentSession: parent.file });
	writeFileSync(join(dir, "junk.jsonl"), "not json\n");
	const first = await listCounting(dir);
	expect(first.listed).toHaveLength(22);
	expect(first.opened.length).toBeGreaterThanOrEqual(23); // every transcript, the junk file, and the parent's header
	const warm = await listCounting(dir);
	expect(warm.listed).toHaveLength(22);
	expect(warm.opened).toEqual([]);
	appendFileSync(files[3], `${JSON.stringify(userEntry("more"))}\n`);
	expect((await listCounting(dir)).opened).toEqual([files[3]]);
});

test("a fork keeps its parent's header id: misleading file names, renamed and archived parents", async () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-index-"));
	// The parent's file name carries a different UUID than its header.
	const parent = writeSession(dir, { text: "parent", name: `2026-01-01T00-00-00-000Z_${randomUUID()}.jsonl` });
	const fork = writeSession(dir, { text: "fork", parentSession: parent.file });
	const forkedFrom = (listed: Awaited<ReturnType<typeof listWithIndex>>) => listed.find((s) => s.id === fork.id)?.forkedFromId;
	expect(forkedFrom(await listWithIndex(dir))).toBe(parent.id);
	// Renamed after the fork was indexed: the cached id stands, and nothing is opened to serve it.
	renameSync(parent.file, join(dir, `renamed-${randomUUID()}.jsonl`));
	const warm = await listCounting(dir);
	expect(forkedFrom(warm.listed)).toBe(parent.id);
	expect(warm.opened.filter((p) => p === fork.file)).toEqual([]);
	// Archived before the fork is first indexed: the archived location is found.
	const dir2 = mkdtempSync(join(tmpdir(), "kc-index-"));
	const parent2 = writeSession(dir2, { text: "parent" });
	const fork2 = writeSession(dir2, { text: "fork", parentSession: parent2.file });
	mkdirSync(join(dir2, "archived"));
	renameSync(parent2.file, join(dir2, "archived", basename(parent2.file)));
	expect((await listWithIndex(dir2)).find((s) => s.id === fork2.id)?.forkedFromId).toBe(parent2.id);
});

test("corrupt indexes and entries are rescanned, never trusted: syntax, version, dates, types, extra fields, long titles", async () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-index-"));
	const files = writeSessions(dir, 5);
	await listWithIndex(dir);
	writeFileSync(indexPath(dir), "{ broken");
	expect(await listWithIndex(dir)).toHaveLength(5);
	writeFileSync(indexPath(dir), JSON.stringify({ version: 99, entries: {} }));
	expect(await listWithIndex(dir)).toHaveLength(5);
	// Valid JSON, matching size and mtime, but each entry wrong in a different way.
	const index = indexOf(dir);
	const entry = (i: number) => index.entries[basename(files[i])];
	entry(0).session.created = "not a date";
	entry(1).session.messageCount = "many";
	entry(2).session.firstMessage = "x".repeat(1_000_000); // an unknown property, however large
	entry(3).session.title = "x".repeat(500); // longer than any title titleOf produces
	entry(4).extra = true; // an unknown property on the entry itself
	writeFileSync(indexPath(dir), JSON.stringify(index));
	const { listed, opened } = await listCounting(dir);
	expect(listed).toHaveLength(5);
	expect(new Set(opened)).toEqual(new Set(files));
	for (const session of listed)
		expect(Object.keys(session).sort()).toEqual(["created", "cwd", "id", "messageCount", "modified", "path", "title"]);
	expect(JSON.stringify(indexOf(dir))).not.toContain("firstMessage");
	const deleted = files[4];
	unlinkSync(deleted);
	expect((await listWithIndex(dir)).map((s) => s.path)).not.toContain(deleted);
	expect(indexOf(dir).entries).not.toHaveProperty(basename(deleted));
});

test("malformed scanned dates skip only their transcript; warm lists open nothing and a repaired file rescans", async () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-index-"));
	const good = writeSession(dir);
	const bad = writeSession(dir, { timestamp: "not-a-date" });
	const overflow = writeSession(dir);
	const activity = userEntry("overflow activity");
	activity.message.timestamp = 1e100; // valid JSON number, but outside Date's range
	appendFileSync(overflow.file, `${JSON.stringify(activity)}\n`);
	const first = await listCounting(dir);
	expect(first.listed.map((s) => s.id)).toEqual([good.id]);
	expect(first.opened).toHaveLength(3);
	expect(indexOf(dir).entries[basename(bad.file)].session).toBeNull();
	expect(indexOf(dir).entries[basename(overflow.file)].session).toBeNull();
	expect((await listCounting(dir)).opened).toEqual([]);
	// Repair the same header id, making size change so no timestamp-resolution assumption is needed.
	const repairedHeader = {
		type: "session",
		version: 3,
		id: bad.id,
		cwd: dir,
		timestamp: "2026-01-01T00:00:00.000Z",
	};
	writeFileSync(bad.file, `${JSON.stringify(repairedHeader)}\n${JSON.stringify(userEntry("repaired"))}\n`);
	const repaired = await listCounting(dir);
	expect(new Set(repaired.listed.map((s) => s.id))).toEqual(new Set([good.id, bad.id]));
	expect(repaired.opened).toEqual([bad.file]);
});

test("an index larger than the budget is not read", async () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-index-"));
	const files = writeSessions(dir, 2);
	await listWithIndex(dir);
	const valid = JSON.stringify(indexOf(dir));
	writeFileSync(indexPath(dir), valid + " ".repeat(MAX_INDEX_BYTES)); // valid JSON, over budget
	const { opened } = await listCounting(dir);
	expect(new Set(opened)).toEqual(new Set(files));
});

test("an entry stores a bounded title, not the first message", async () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-index-"));
	writeSession(dir, { text: "x".repeat(1_000_000) });
	const [session] = await listWithIndex(dir);
	expect([...session.title].length).toBeLessThanOrEqual(201);
	expect(statSync(indexPath(dir)).size).toBeLessThan(2_000);
});

test("a failed index write leaves the listing correct", async () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-index-"));
	writeSessions(dir, 2);
	mkdirSync(indexPath(dir)); // a directory where the index file belongs: read and rename both fail
	expect(await listWithIndex(dir)).toHaveLength(2);
	expect(await listWithIndex(dir)).toHaveLength(2);
});
```

In `server.test.ts`, extend Task 1's diagnostics test: after a `thread/list` over a session directory with two saved threads, `listingFilesOpened` grew by at least 2 and `listingBytesScanned` by at least the two files' sizes; after a second `thread/list`, neither grew.

Run: `cd packages/cli && bun x vitest --run test/app-server/listing-index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement**

Export `buildSessionInfo`, `mapWithConcurrency` and `sessionCwdMatches` from `session-manager.ts` (`:850`, `:952`, `:795`; add `export`, no other change). Check `mapWithConcurrency`'s exact parameters at `:952` (it may take an `AbortSignal` last) and match them.

```ts
/** A cache of what a listing needs per session file (§5.10). Never the source of truth. */

import { randomUUID } from "node:crypto";
import { readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import { buildSessionInfo, mapWithConcurrency } from "../core/session-manager.ts";
import { titleOf } from "./loaded-thread.ts";
import { parentIdOf } from "./session-files.ts";

const INDEX_FILE = ".thread-index.json";
const VERSION = 1;
const CONCURRENCY = 64;
export const MAX_INDEX_BYTES = 16 * 1024 * 1024;
/** titleOf cuts to 200 code points and adds an ellipsis. */
const MAX_TITLE_CODE_POINTS = 201;

export interface IndexedSession {
	path: string;
	id: string;
	cwd: string;
	/** The display title, already bounded (titleOf): never the first message itself. */
	title: string;
	/** The parent's header id, resolved when this file was scanned. */
	forkedFromId?: string;
	created: Date;
	modified: Date;
	messageCount: number;
}

const strict = { additionalProperties: false } as const;
const StoredSession = Type.Object(
	{
		id: Type.String({ maxLength: 128 }),
		cwd: Type.String({ maxLength: 4096 }),
		title: Type.String({ maxLength: 4 * MAX_TITLE_CODE_POINTS }),
		forkedFromId: Type.Optional(Type.String({ maxLength: 128 })),
		created: Type.String({ maxLength: 64 }),
		modified: Type.String({ maxLength: 64 }),
		messageCount: Type.Integer({ minimum: 0 }),
	},
	strict,
);
const Entry = Type.Object(
	{
		size: Type.Integer({ minimum: 0 }),
		mtimeMs: Type.Number(),
		/** null: a .jsonl that is not a session, remembered so it is not re-read every listing. */
		session: Type.Union([StoredSession, Type.Null()]),
	},
	strict,
);
const isEntry = Compile(Entry);
type StoredSession = Static<typeof StoredSession>;
type Entry = Static<typeof Entry>;
export type ReadKind = "transcript" | "parentHeader";

async function readIndex(dir: string): Promise<Record<string, unknown>> {
	try {
		const path = join(dir, INDEX_FILE);
		if ((await stat(path)).size > MAX_INDEX_BYTES) return {}; // refuse unread: a cache that large is not trusted
		const parsed = JSON.parse(await readFile(path, "utf8")) as { version?: unknown; entries?: unknown };
		return parsed.version === VERSION && typeof parsed.entries === "object" && parsed.entries !== null && !Array.isArray(parsed.entries)
			? (parsed.entries as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** A stored entry, only if every field is well formed; otherwise undefined and the file is rescanned. */
function validEntry(value: unknown): Entry | undefined {
	if (!isEntry.Check(value)) return undefined;
	const entry = value as Entry;
	const session = entry.session;
	if (session) {
		if (Number.isNaN(Date.parse(session.created)) || Number.isNaN(Date.parse(session.modified))) return undefined;
		if ([...session.title].length > MAX_TITLE_CODE_POINTS) return undefined;
	}
	return entry;
}

/** Built from the named fields only, so nothing else in the file reaches memory. */
const revive = (path: string, s: StoredSession): IndexedSession => ({
	path,
	id: s.id,
	cwd: s.cwd,
	title: s.title,
	...(s.forkedFromId !== undefined ? { forkedFromId: s.forkedFromId } : {}),
	created: new Date(s.created),
	modified: new Date(s.modified),
	messageCount: s.messageCount,
});

/** Best effort: the listing is already computed; a cache that cannot be written only costs a rescan next time. */
async function writeIndex(dir: string, entries: Record<string, Entry>): Promise<void> {
	const temp = join(dir, `${INDEX_FILE}.${process.pid}.${randomUUID()}.tmp`);
	try {
		await writeFile(temp, JSON.stringify({ version: VERSION, entries }));
		await rename(temp, join(dir, INDEX_FILE)); // atomic: readers see the old index or the new one
	} catch {
		await rm(temp, { force: true }).catch(() => {});
	}
}

export async function listWithIndex(
	dir: string,
	options: { onRead?: (path: string, kind: ReadKind, bytes: number) => void } = {},
): Promise<IndexedSession[]> {
	const previous = await readIndex(dir);
	const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".jsonl"));
	const next: Record<string, Entry> = {};
	let changed = Object.keys(previous).length !== names.length;
	const results = await mapWithConcurrency(names, CONCURRENCY, async (name): Promise<IndexedSession | undefined> => {
		const path = join(dir, name);
		const stats = await stat(path).catch(() => undefined);
		if (!stats?.isFile()) return undefined;
		const cached = validEntry(previous[name]);
		if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
			next[name] = cached;
			return cached.session ? revive(path, cached.session) : undefined;
		}
		changed = true;
		options.onRead?.(path, "transcript", stats.size);
		const info = await buildSessionInfo(path, undefined, stats).catch(() => null);
		// Check the fresh Date objects BEFORE toISOString(), which throws on an invalid date.
		if (!info || !Number.isFinite(info.created.getTime()) || !Number.isFinite(info.modified.getTime())) {
			next[name] = { size: stats.size, mtimeMs: stats.mtimeMs, session: null };
			return undefined;
		}
		const forkedFromId = parentIdOf(info.parentSessionPath, (parent) => options.onRead?.(parent, "parentHeader", 0));
		const session: StoredSession = {
			id: info.id,
			cwd: info.cwd,
			title: titleOf(info.name, info.firstMessage),
			...(forkedFromId !== undefined ? { forkedFromId } : {}),
			created: info.created.toISOString(),
			modified: info.modified.toISOString(),
			messageCount: info.messageCount,
		};
		const scanned = validEntry({ size: stats.size, mtimeMs: stats.mtimeMs, session });
		if (!scanned) {
			next[name] = { size: stats.size, mtimeMs: stats.mtimeMs, session: null };
			return undefined;
		}
		next[name] = scanned;
		return revive(path, session);
	});
	if (changed) await writeIndex(dir, next);
	return results.filter((s): s is IndexedSession => s !== undefined);
}
```

`titleOf` already lives in `loaded-thread.ts` and is what `list()` displays today, so the stored title is exactly what the sidebar shows. If importing `loaded-thread.ts` here creates an import cycle through `threads.ts`, move `titleOf` into its own small module and import it from both.

`threads.ts`: `ThreadManager` keeps `private listingFilesOpened = 0` and `private listingBytesScanned = 0`, passes `onRead: (_path, _kind, bytes) => { this.listingFilesOpened++; this.listingBytesScanned += bytes; }` to every `listWithIndex` call, and reports both in `diagnostics()`; add both fields (`Num`) to the `server/diagnostics` result schema and its protocol example. `list()`:

```ts
const archived = params.archived === true;
const onRead = (_path: string, _kind: ReadKind, bytes: number) => {
	this.listingFilesOpened++;
	this.listingBytesScanned += bytes;
};
let sessions: IndexedSession[] = [];
if (params.cwd !== undefined) {
	const cwd = resolvePath(params.cwd);
	const live = liveDirFor(this.ctx, cwd);
	const dir = archived ? join(live, ARCHIVE_DIR) : live;
	if (existsSync(dir)) sessions = await listWithIndex(dir, { onRead });
	// A shared session directory (flag, env, settings) holds every project's threads: filter by header cwd,
	// as SessionManager.list does (session-manager.ts:2043-2045).
	if (this.ctx.sessionDir !== undefined) sessions = sessions.filter((s) => sessionCwdMatches(s.cwd, cwd));
} else {
	// One directory at a time: at most 64 transcripts open across the whole listing, however many projects.
	for (const dir of await sessionDirs(this.ctx, archived)) sessions.push(...(await listWithIndex(dir, { onRead })));
}
```

The rest of `list()` keeps its filter (`messageCount > 0`), sort (`modified`, newest first) and mapping, using `session.title` directly as `name`, `createdAt` from `session.created`, and `forkedFromId` from `session.forkedFromId`. Task 2's per-listing `parentIdOf` call in `list()` is removed: the index resolved it.

- [ ] **Step 3: Run, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/listing-index.test.ts test/app-server/listing-pages.test.ts test/app-server/`
Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run`
Run: `bun run check-types`
Expected: PASS.

```bash
git add packages/cli/src/app-server/listing-index.ts packages/cli/src/core/session-manager.ts packages/cli/src/app-server/threads.ts packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/test/protocol.test.ts packages/cli/docs/app-server.schema.json packages/cli/test/app-server/listing-index.test.ts packages/cli/test/app-server/server.test.ts
git commit -m "feat(cli): cache thread listings in a validated, bounded per-directory index"
```

---

### Task 12: Docs, changeset, schema and validation

**Files:**
- Modify: `packages/cli/docs/app-server.md` (protocol 2 reference: every new method, notification, field and error code from Tasks 1-11; the prefix rules; the listing index)
- Modify: `packages/cli/docs/session-format.md` (the end entry's `error` object with `kind`, and how a protocol 1 string error reads)
- Modify (generated): `packages/cli/docs/app-server.schema.json`
- Create: `.changeset/<branch>.md` via `bun run changeset changed`
- Create: `packages/cli/test/app-server/bench/thread-list.bench.ts`
- Modify: `apps/desktop/docs/desktop-app/architecture.md` §13 (the listing benchmark figures)

- [x] **Step 1: Docs**

Write `app-server.md` changes in the file's existing style: one subsection per new method with params, result, errors and one example; a "Changes from protocol 1" list matching architecture.md §4.6. Do not add anything to the system prompt.

- [x] **Step 2: Changeset**

Run: `bun run changeset changed`
Complete the summary: "Changed the app server protocol to version 2: thread status reports waiting approvals, turns and items carry times and typed errors, steers and interrupts name their turn, shell approvals can allow a command prefix, and settings can be written over the protocol."
Run: `bun run scripts/changelog-sections.ts`
Expected: PASS.

- [x] **Step 3: Benchmark `thread/list` at the protocol level with a checked-in harness**

§13 records the Phase A listing measurements from a temporary script that is not in this checkout. This step adds a harness anyone can rerun, measuring what §5.10 promises through the protocol a client uses, not the index function alone. Create `packages/cli/test/app-server/bench/thread-list.bench.ts` (not a Vitest file; Vitest picks up only `*.test.ts`):

```ts
/**
 * thread/list benchmark (architecture.md §5.10, §13). Run from the repo root under Bun:
 *   bun packages/cli/test/app-server/bench/thread-list.bench.ts 1000
 *   bun packages/cli/test/app-server/bench/thread-list.bench.ts 10000
 * Prints one JSON line per measured request. Writes only under a temporary directory, which it removes.
 *
 * Transcript opens and bytes come from the server's own counters (server/diagnostics listingFilesOpened and
 * listingBytesScanned, Task 11), sampled before and after each request. Peak heap is sampled every 2 ms from
 * bun:jsc heapStats().heapSize, the figure §13 uses because Bun's process.memoryUsage().heapUsed can be stale.
 */

import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { heapStats } from "bun:jsc";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppServerContext } from "../../../src/app-server/context.ts";
import { appServerHandlers } from "../../../src/app-server/entry.ts";
import { createInProcessClient } from "../../../src/app-server/in-process.ts";
import { ThreadManager } from "../../../src/app-server/threads.ts";

const count = Number(process.argv[2] ?? 1000);
const root = mkdtempSync(join(tmpdir(), "kc-list-bench-"));
const agentDir = join(root, "agent");
const sessionDir = join(root, "sessions");
mkdirSync(agentDir);
mkdirSync(sessionDir);

const header = (id: string, parentSession?: string) =>
	JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: root, ...(parentSession ? { parentSession } : {}) });
const userLine = (text: string) =>
	JSON.stringify({ type: "message", id: randomUUID().slice(0, 8), parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: text, timestamp: Date.now() } });
const fileFor = (id: string) => join(sessionDir, `2026-10-14T00-00-00-000Z_${id}.jsonl`);

for (let i = 0; i < count; i++) {
	const id = randomUUID();
	writeFileSync(fileFor(id), `${header(id)}\n${userLine(`session ${i}`)}\n`);
}
// One transcript whose single first message is 100 MiB: the index's worst case (§5.10). Written in 1 MiB
// pieces of one JSON line, so the harness never holds the whole string.
{
	const id = randomUUID();
	const file = fileFor(id);
	const prefix = userLine("@@BODY@@");
	const [before, after] = prefix.split("@@BODY@@");
	writeFileSync(file, `${header(id)}\n${before}`);
	const piece = "x".repeat(1024 * 1024);
	for (let i = 0; i < 100; i++) appendFileSync(file, piece);
	appendFileSync(file, `${after}\n`);
}
// Twenty forks whose parents' file names carry a different, misleading UUID than their headers, as imported or
// renamed transcripts can: fork identity must come from the parent's header, read once on the cold listing.
for (let i = 0; i < 20; i++) {
	const parentId = randomUUID();
	const parentFile = join(sessionDir, `2026-01-01T00-00-00-000Z_${randomUUID()}.jsonl`);
	writeFileSync(parentFile, `${header(parentId)}\n${userLine(`parent ${i}`)}\n`);
	const forkId = randomUUID();
	writeFileSync(fileFor(forkId), `${header(forkId, parentFile)}\n${userLine(`fork ${i}`)}\n`);
}

const ctx = await createAppServerContext({ agentDir, sessionDir, credentials: new InMemoryCredentialStore(), modelsPath: null });
const threads = new ThreadManager(ctx);
const client = createInProcessClient({ handlers: appServerHandlers(ctx, threads), version: "bench" });
await client.initialize({ name: "bench" });

async function measure<T>(label: string, run: () => Promise<T>): Promise<T> {
	let peak = heapStats().heapSize;
	const sampler = setInterval(() => (peak = Math.max(peak, heapStats().heapSize)), 2);
	const before = await client.request("server/diagnostics", {});
	const started = performance.now();
	const result = await run();
	const ms = performance.now() - started;
	const after = await client.request("server/diagnostics", {});
	clearInterval(sampler);
	console.log(
		JSON.stringify({
			label,
			sessions: count + 41,
			ms: Number(ms.toFixed(1)),
			filesOpened: after.listingFilesOpened - before.listingFilesOpened,
			bytesScanned: after.listingBytesScanned - before.listingBytesScanned,
			peakHeapBytes: peak,
			runtime: `bun ${Bun.version} ${process.platform}`,
		}),
	);
	return result;
}

try {
	for (const run of ["cold", "warm"]) {
		let page = await measure(`${run} initial`, () => client.request("thread/list", {}));
		let continuation = 0;
		while (page.nextCursor) {
			const cursor = page.nextCursor;
			page = await measure(`${run} continuation ${++continuation}`, () => client.request("thread/list", { cursor }));
		}
	}
} finally {
	client.close();
	await threads.closeAll();
	rmSync(root, { recursive: true, force: true });
}
```

Before running, confirm `appServerHandlers` is importable without side effects (Task 0 may have moved it to `handlers.ts`; import it from where it lives) and that `ThreadManager`'s constructor needs nothing else in this setup (`harness.ts` builds it the same way).

Run it for 1,000 and 10,000 sessions on Windows and on Linux (WSL2 is acceptable), twice each, and record the printed lines in architecture.md §13 below the Phase A table, with the platform and runtime. Acceptance, checked against the printed numbers:

- `warm initial`: `filesOpened` 0 and `bytesScanned` 0, including the 20 forks and their misleadingly named parents.
- Every `continuation` line, cold and warm: `filesOpened` 0 and `bytesScanned` 0.
- `cold initial`: every transcript scanned once (`bytesScanned` at least the fixture's total size, including the 100 MiB transcript) and one parent header read per fork, so `filesOpened` is the transcript count plus 20.
- The index file in `sessionDir` stays small (record its size): the 100 MiB transcript contributes a bounded title, not its message.

If any of these fails, Task 11 is not done.

- [x] **Step 4: Full validation**

Run, from the repo root:
- `bun run check-types`
- `cd packages/app-server-protocol && bun x vitest --run`
- `cd packages/cli && bun x vitest --run test/app-server/ test/agent-session-queue.test.ts test/settings-manager-write-key.test.ts test/suite/turn-marker.test.ts`
- `cd packages/ai && bun x vitest --run test/retry.test.ts test/overflow.test.ts`
- `cd packages/agent && bun x vitest --run`
- `bun x prettier --check "packages/app-server-protocol/**/*.ts" "packages/cli/src/app-server/**/*.ts"`
- `rg -n "from \"@knightcode/(ai|agent)\"" packages/app-server-protocol/src` → no matches
- `rg -n "exec\(|execSync\(|shell: true" packages/cli/src/app-server` → no matches
- `rg -n "protocolVersion: 1" packages/cli/src` → no matches (the only test match is Task 1's deliberate rejection test in `server.test.ts`)
- `rg -n "acceptForSession" packages/cli/src/app-server/approvals.ts` → only the non-shell path

Expected: every command passes and every grep matches as stated.

- [ ] **Step 5: Commit** (if authorized)

```bash
git add packages/cli/docs/app-server.md packages/cli/docs/session-format.md packages/cli/docs/app-server.schema.json .changeset/<branch>.md packages/cli/test/app-server/bench/thread-list.bench.ts apps/desktop/docs/desktop-app/architecture.md
git commit -m "docs(cli): document protocol 2"
```

---

## After this plan

- Phase B (worktrees, diffs, git; architecture.md §6 including the protocol 2 worktree additions) gets its own plan.
- The desktop app's Phase S1 (desktop-shell.md section 15) can start once Tasks 0-7 and 10 are in: the shell, sidebar, transcript, composer and approvals need Tasks 1-7, and main's holder routing needs Task 10's `thread/unsubscribe` status (desktop-shell.md section 4.3). Tasks 8, 9 and 11 are needed before S1's settings page, `@` mentions and a large sidebar respectively.
