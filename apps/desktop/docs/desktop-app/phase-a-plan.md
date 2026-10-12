# Phase A — app server core: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `knightcode app-server`: one headless process that hosts many KnightCode threads over one `ModelRuntime`, speaks the Phase A protocol over stdio and in-process, locks live session files, gates tools with three approval modes, and unloads idle threads.

**Architecture:** A new private package `@knightcode/app-server-protocol` holds TypeBox schemas for every Phase A message. `packages/cli/src/app-server/` holds one `AppServer` per connection over a `Transport` (ndjson stdio or paired in-memory queues), and one process-wide `ThreadManager` of `LoadedThread`s, each wrapping an `AgentSession` built the way the terminal builds one. Core changes come first: the session lock and its write contract live in `SessionManager`, so the terminal takes the lock too; virtual-model routes in the shared `ModelRuntime` are owned by the session that registered them; a built-in extension writes a start and an end entry around every agent run, which gives turns stable ids and a durable outcome.

**Tech Stack:** TypeScript on Bun 1.3, TypeBox 1.3.27 (`typebox`, `typebox/compile`), `proper-lockfile` 4.1.2 (already a cli dependency), Vitest, the faux provider (`fauxProvider` from `@knightcode/ai`).

**Spec:** `apps/desktop/docs/desktop-app/architecture.md` (revised after the gap, design and implementation-risk reviews). The plan argues from it; read both. Section numbers below (§) refer to the spec.

## Global Constraints

- Formatting is Prettier: tabs, 120 columns, LF. `bun run format` before each commit.
- No `any`. No inline imports (`await import()`, `import("x").T`). `erasableSyntaxOnly`: no parameter properties, `enum`, `namespace`; use explicit fields assigned in constructors.
- `@knightcode/app-server-protocol/src` imports nothing from `@knightcode/ai` or `@knightcode/agent`.
- No `exec(`, `execSync(` or `shell: true` under `packages/cli/src/app-server`.
- Windows and POSIX: `node:path` for joins, `resolvePath` for user-supplied cwd/path expansion, then `canonicalSessionPath` (Task 2) for persisted session ownership and binding. `resolvePath` alone does not resolve symlinks/junctions. LF in all files.
- No system-prompt text added in Phase A. No model names in product code; tests pick the faux model from `model/list` or `faux.getModel()`.
- Tests never touch the real `~/.knightcode`: every test passes a temp `agentDir` and session dir. The faux provider only; no real provider keys or paid tokens. Every thread a test starts is pinned to the faux model.
- No production code that exists only to simulate another process in a test. "Another process" in a test is a child process (`process.execPath` running a fixture script), or a lock directory and owner token written directly with `node:fs` (never a second in-process `proper-lockfile` lock: it would share proper-lockfile's module-level lock table, which two real processes never do).
- Nothing writes a session file it does not hold the lock on (§5.5). Every task that adds a write path to a session file says where its lock comes from.
- Race tests never sleep a fixed time. They block on a gate that signals when the operation has reached its blocking point (an extension factory or hook, a stubbed await), and assert ordering with recorded events. Timer behaviour (lock refresh, idle unload) runs under Vitest fake timers.
- After code changes: `bun run check-types` from the repo root, full output.
- Tests run from the package root: `bun x vitest --run test/<file>`.
- Commits: only when the user has authorized committing for this run (AGENTS.md: never commit unless asked). Without that, finish each task at the passing tests and the type check, and list the files it changed. When committing: `{feat,fix,docs,refactor,chore}(<scope>): <message>`, scope `cli` or `app-server-protocol`; no reference to other harnesses; no `Co-Authored-By` trailer.
- Staging: the explicit files a task names, never a directory, `git add -A` or `git add .`. Other sessions may be editing this checkout. Run `git status` before each commit and stage only this task's files.

## Review Focus

1. A process that stalls or sleeps longer than the lock's stale threshold while threads are open: if nobody took the file, writing simply continues (proper-lockfile renews the late refresh); if another process took it, the very next write is rejected, and neither our release, nor proper-lockfile's exit cleanup, nor its refresh timer touches the other process's lock directory (Task 2).
2. A closed or lost `SessionManager`: every write and tree-move path, `branchWithSummary` included, throws before it changes memory or disk; `forkFrom` locks its destination before the file exists (Task 2).
3. A `thread/resume` that arrives while the same thread is unloading or being archived, and an archive that arrives while a resume is still loading: either way one session at a time, and none left on a moved file (Tasks 9, 10).
4. A huge, malformed or multibyte stdin line from a buggy client: the server answers an `error` notification, drops the line by its byte length and keeps serving (Task 6).
5. A client that disconnects or unsubscribes while an approval request is open: with another subscriber the request moves there; with none the call is blocked as cancelled and reads back that way (Task 12).
6. stdin reaching EOF: requests already accepted are still answered; mid-turn, every thread unloads, every lock is released, and the process exits 0 within the shutdown deadline (Tasks 6, 7, 9, 14).
7. Live item order: a reply `[toolCall, text]` and a result a `message_end` handler replaced reach the client in the order and with the content `thread/read` returns (Task 11).
8. `turn/interrupt` during any part of preflight (auth check, `input` hook, an extension command and the prompt it dispatches) launches no run (Task 11).
9. File/directory symlinks and Windows junctions share one ownership identity; failed session switches never leave an unlocked writable manager (Task 2).
10. Archive destinations can be locked or contain an imported transcript with the same basename: protect both paths, publish without replacement, and preserve both files on refusal (Task 10).
11. A replacement's `withSession` prompt survives old-thread disposal but still observes interruption while loading, setting up or preflighting the target (Tasks 11, 13).
12. Historical unfinished calls never become running in a later turn; finalized block-kind replacements remove obsolete items before reusing their ids (Tasks 10, 11).
13. History continuations stay anchored under appends; an old-page resume still supplies a current running snapshot; large turns/items use payload references instead of overflowing output (Tasks 1, 10, 11).
14. Initial listing scan cost is explicit and benchmarked; listing continuations do not rescan; extension factories, unloaded sessions/routes and expired payloads do not accumulate over repeated project cycles (Tasks 5, 10, 15).

All snippets below are proposed implementation, not code already shipped.
Phase B Git safety is corrected in architecture §6 and its required tests;
this Phase A plan does not implement Git handoff. Do not freeze protocol v1
until the reference, schemas, client reducer and both transports agree on
start dispositions, history anchors, separate snapshots and payload refs.

---

### Task 1: The protocol package

**Files:**
- Create: `packages/app-server-protocol/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/protocol.ts`, `src/index.ts`, `scripts/generate-schema.ts`, `test/protocol.test.ts`
- Create (generated): `packages/cli/docs/app-server.schema.json`
- Modify: `tsconfig.json` (paths), `packages/cli/package.json` (dependency), `AGENTS.md` (layout table)

**Interfaces:**
- Produces: `PROTOCOL_VERSION`; schemas and `Static` types `Thread`, `ThreadSummary`, `Turn`, `TurnSummary`, `WireTurn`, `Item`, `WireItem`, `PayloadRef`, `TurnStartResult`, `ApprovalMode`, `ThinkingLevel`, `ModelRef`, `ModelSelector`, `ImageRef`, `ToolOutput`, `ErrorCode`; tables `ClientRequests`, `ClientNotifications`, `ServerNotifications`, `ServerRequests`; helper types `ClientMethod`, `ParamsOf<M>`, `ResultOf<M>`, `NotificationMethod`, `NotificationParams<M>`, `ServerRequestMethod`, `ServerRequestParams<M>`, `ServerRequestResult<M>`; envelope types `RequestId`, `Request`, `Notification`, `Response`, `Message`, `ResponseError`; `schemaDocument()`.

Phase A carries only Phase A messages. `view` on items, `ui/*`, workspaces other than `local`, `turn/diff/updated` and the git methods arrive with Phases B and C.

- [ ] **Step 1: Scaffold the package**

`packages/app-server-protocol/package.json`:

```json
{
	"name": "@knightcode/app-server-protocol",
	"version": "0.1.0",
	"private": true,
	"type": "module",
	"main": "./src/index.ts",
	"types": "./src/index.ts",
	"exports": {
		".": "./src/index.ts",
		"./package.json": "./package.json"
	},
	"dependencies": {
		"typebox": "1.3.27"
	},
	"devDependencies": {
		"@knightcode/agent": "workspace:*"
	},
	"scripts": {
		"test": "vitest --run",
		"generate:schema": "bun scripts/generate-schema.ts"
	}
}
```

`tsconfig.json` and `vitest.config.ts`: copy `packages/protocol/tsconfig.json` and `packages/protocol/vitest.config.ts` verbatim.

Root `tsconfig.json` `paths`, beside the `@knightcode/protocol` entry:

```json
"@knightcode/app-server-protocol": ["./packages/app-server-protocol/src/index.ts"],
```

`packages/cli/package.json` `dependencies`, keeping alphabetical order:

```json
"@knightcode/app-server-protocol": "workspace:*",
```

`AGENTS.md` layout table, after the `packages/protocol` row:

```markdown
| `packages/app-server-protocol` | Schemas and types of the app server protocol; imports nothing from `ai` or `agent` |
```

Run `bun install` from the repo root. It links the workspace package; `bun.lock` changes only by the new workspace entry.

- [ ] **Step 2: Write the failing test**

`packages/app-server-protocol/test/protocol.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel as AgentThinkingLevel } from "@knightcode/agent";
import type { Static, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { describe, expect, test } from "vitest";
import {
	ClientNotifications,
	ClientRequests,
	schemaDocument,
	ServerNotifications,
	ServerRequests,
	type ThinkingLevel,
} from "../src/index.ts";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const thinkingLevelsAgree: Same<Static<typeof ThinkingLevel>, AgentThinkingLevel> = true;

const thread = {
	id: "t1",
	cwd: "/p",
	projectCwd: "/p",
	name: "fix it",
	status: "idle",
	archived: false,
	updatedAt: "2026-10-11T00:00:00.000Z",
	workspace: { mode: "local" },
	approvalMode: "ask",
	thinkingLevel: "off",
};
const summary = {
	id: "t1",
	cwd: "/p",
	projectCwd: "/p",
	name: "fix it",
	status: "notLoaded",
	archived: false,
	updatedAt: "2026-10-11T00:00:00.000Z",
};
const turn = { id: "m1", threadId: "t1", status: "completed", items: [] };
const item = { type: "agentMessage", id: "m1:0:0", text: "hi" };
const login = { status: "pending", loginId: "l1", events: [] };

// One valid example per message. A message without an example fails the coverage test below.
const requestParams: Record<string, unknown> = {
	initialize: { clientInfo: { name: "test", version: "1" }, protocolVersion: 1, capabilities: {} },
	"thread/start": { cwd: "/p", approvalMode: "ask", model: { provider: "faux", id: "m" }, thinkingLevel: "low" },
	"thread/resume": { threadId: "t1", cursor: "opaque-history-anchor" },
	"thread/fork": { threadId: "t1", atItemId: "m1:user:0" },
	"thread/list": { cwd: "/p", cursor: "opaque-list-snapshot", archived: false },
	"thread/read": { threadId: "t1", cursor: "opaque-history-anchor" },
	"thread/unsubscribe": { threadId: "t1" },
	"thread/archive": { threadId: "t1" },
	"thread/unarchive": { threadId: "t1" },
	"thread/name/set": { threadId: "t1", name: "n" },
	"thread/settings/update": { threadId: "t1", thinkingLevel: "high", approvalMode: "fullAccess" },
	"thread/compact": { threadId: "t1", instructions: "keep the plan" },
	"turn/start": { threadId: "t1", text: "hi", images: [{ mimeType: "image/png", data: "AA==" }] },
	"turn/steer": { threadId: "t1", text: "also this" },
	"turn/followUp": { threadId: "t1", text: "then this" },
	"turn/interrupt": { threadId: "t1" },
	"payload/read": { id: "issued-payload-id", offset: 0, maxBytes: 49152 },
	"model/list": {},
	"command/list": { threadId: "t1" },
	"config/read": { cwd: "/p" },
	"account/list": {},
	"account/login/start": { provider: "anthropic", type: "oauth" },
	"account/login/answer": { loginId: "l1", value: "code" },
	"account/login/cancel": { loginId: "l1" },
	"account/logout": { provider: "anthropic" },
};
const requestResults: Record<string, unknown> = {
	initialize: { serverInfo: { name: "knightcode", version: "0.0.0" }, protocolVersion: 1 },
	"thread/start": { thread },
	"thread/resume": { thread, turns: [turn], nextCursor: "opaque-history-anchor" },
	"thread/fork": { thread },
	"thread/list": { threads: [summary], nextCursor: "opaque-list-snapshot" },
	"thread/read": { thread: summary, turns: [turn] },
	"thread/unsubscribe": {},
	"thread/archive": {},
	"thread/unarchive": {},
	"thread/name/set": {},
	"thread/settings/update": { thread },
	"thread/compact": {},
	"turn/start": { status: "started", threadId: "t1", requestId: "r1" },
	"turn/steer": {},
	"turn/followUp": {},
	"turn/interrupt": {},
	"payload/read": { data: "e30=", eof: true },
	"model/list": {
		models: [
			{
				provider: "faux",
				providerName: "Faux",
				id: "m",
				name: "M",
				contextWindow: 1000,
				maxTokens: 100,
				reasoning: false,
				input: ["text"],
			},
		],
		default: null,
	},
	"command/list": { commands: [{ name: "plan", description: "Plan first" }] },
	"config/read": { settings: { theme: "dark" } },
	"account/list": {
		accounts: [{ provider: "anthropic", providerName: "Anthropic", type: "oauth", isSubscription: true }],
		loginOptions: [
			{ provider: "anthropic", providerName: "Anthropic", type: "oauth", label: "Claude", isSubscription: true },
		],
	},
	"account/login/start": { loginId: "l1" },
	"account/login/answer": {},
	"account/login/cancel": {},
	"account/logout": {},
};
const notificationParams: Record<string, unknown> = {
	initialized: {},
	"thread/started": { thread },
	"thread/replaced": { oldThreadId: "t0", thread },
	"thread/status/changed": { threadId: "t1", status: "active" },
	"thread/name/updated": { threadId: "t1", name: "n" },
	"thread/settings/updated": { thread },
	"thread/archived": { threadId: "t1", archived: true },
	"turn/started": { turn, requestId: "r1" },
	"turn/completed": { turn: { id: "m1", threadId: "t1", status: "completed" } },
	"turn/retry": { threadId: "t1", turnId: "m1", attempt: 1, maxAttempts: 3, delayMs: 1000, error: "overloaded" },
	"turn/queue/updated": { threadId: "t1", steering: ["a"], followUp: [] },
	"item/started": { threadId: "t1", turnId: "m1", item, index: 0 },
	"item/completed": { threadId: "t1", turnId: "m1", item, index: 0 },
	"item/removed": { threadId: "t1", turnId: "m1", itemId: "m1:0:1" },
	"item/agentMessage/delta": { threadId: "t1", turnId: "m1", itemId: "m1:0:0", delta: "h" },
	"item/reasoning/delta": { threadId: "t1", turnId: "m1", itemId: "m1:0:1", delta: "h" },
	"item/toolCall/outputDelta": { threadId: "t1", turnId: "m1", itemId: "call_1", output: [{ type: "text", text: "x" }] },
	"serverRequest/cancelled": { id: 3 },
	"account/login/updated": login,
	"account/updated": { provider: "anthropic", authenticated: true },
	error: { message: "bad line" },
};
const serverRequestParams: Record<string, unknown> = {
	"item/toolCall/requestApproval": { threadId: "t1", turnId: "m1", itemId: "call_1", tool: "bash", input: {} },
};
const serverRequestResults: Record<string, unknown> = {
	"item/toolCall/requestApproval": { decision: "accept" },
};

function checkSchema(name: string, schema: TSchema, example: unknown): void {
	const check = Compile(schema);
	expect(check.Check(example), `${name} accepts its example`).toBe(true);
	if (typeof example !== "object" || example === null || Array.isArray(example)) return;
	expect(check.Check({ ...example, unknownMember: 1 }), `${name} rejects an unknown member`).toBe(false);
	const required = (schema as { required?: string[] }).required ?? [];
	if (required.length > 0) {
		const { [required[0]]: _dropped, ...missing } = example as Record<string, unknown>;
		expect(check.Check(missing), `${name} rejects a missing ${required[0]}`).toBe(false);
	}
}

describe("app server protocol", () => {
	test("ThinkingLevel matches @knightcode/agent", () => {
		expect(thinkingLevelsAgree).toBe(true);
	});

	test("every message has an example", () => {
		expect(Object.keys(requestParams).sort()).toEqual(Object.keys(ClientRequests).sort());
		expect(Object.keys(requestResults).sort()).toEqual(Object.keys(ClientRequests).sort());
		expect(Object.keys(notificationParams).sort()).toEqual(
			[...Object.keys(ClientNotifications), ...Object.keys(ServerNotifications)].sort(),
		);
		expect(Object.keys(serverRequestParams).sort()).toEqual(Object.keys(ServerRequests).sort());
	});

	test("client requests accept valid params and results and reject malformed ones", () => {
		for (const [method, { params, result }] of Object.entries(ClientRequests)) {
			checkSchema(`${method} params`, params, requestParams[method]);
			checkSchema(`${method} result`, result, requestResults[method]);
		}
	});

	test("notifications accept valid params and reject malformed ones", () => {
		for (const [method, params] of Object.entries({ ...ClientNotifications, ...ServerNotifications })) {
			checkSchema(method, params, notificationParams[method]);
		}
	});

	test("server requests accept valid params and results and reject malformed ones", () => {
		for (const [method, { params, result }] of Object.entries(ServerRequests)) {
			checkSchema(`${method} params`, params, serverRequestParams[method]);
			checkSchema(`${method} result`, result, serverRequestResults[method]);
		}
	});

	test("the generated JSON Schema is up to date", () => {
		const path = join(import.meta.dirname, "../../cli/docs/app-server.schema.json");
		expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(schemaDocument(), null, "\t")}\n`);
	});
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd packages/app-server-protocol && bun x vitest --run test/protocol.test.ts`
Expected: FAIL, cannot resolve `../src/index.ts`.

- [ ] **Step 4: Write the schemas**

`packages/app-server-protocol/src/protocol.ts`:

```ts
/**
 * The app server protocol (apps/desktop/docs/desktop-app/architecture.md §4).
 *
 * JSON-RPC 2.0 shapes without the "jsonrpc" member. Every object schema
 * rejects unknown members, so a typo in a client fails loudly at the server.
 * This module imports nothing from @knightcode/ai or @knightcode/agent: the
 * desktop renderer imports it to get a type.
 */

import { type Static, type TSchema, Type } from "typebox";

export const PROTOCOL_VERSION = 1;

function Obj<P extends Record<string, TSchema>>(properties: P) {
	return Type.Object(properties, { additionalProperties: false });
}

const Str = Type.String();
const Num = Type.Number();
const Bool = Type.Boolean();
const Empty = Obj({});
const ThreadId = Obj({ threadId: Str });

export const RequestId = Type.Union([Type.String({ maxLength: 128 }), Type.Number()]);
export type RequestId = Static<typeof RequestId>;

export const ErrorCode = Type.Union([
	Type.Literal("invalidParams"),
	Type.Literal("methodNotFound"),
	Type.Literal("notInitialized"),
	Type.Literal("versionMismatch"),
	Type.Literal("threadNotFound"),
	Type.Literal("threadLockedElsewhere"),
	Type.Literal("turnInProgress"),
	Type.Literal("invalidCursor"),
	Type.Literal("payloadNotFound"),
	Type.Literal("archiveConflict"),
	Type.Literal("authRequired"),
	Type.Literal("gitConflict"),
	Type.Literal("notGitRepo"),
	Type.Literal("toolMissing"),
	Type.Literal("shuttingDown"),
	Type.Literal("internal"),
]);
export type ErrorCode = Static<typeof ErrorCode>;

export const ResponseError = Obj({ code: ErrorCode, message: Str, data: Type.Optional(Type.Unknown()) });
export type ResponseError = Static<typeof ResponseError>;

/** Any well-formed message; per-method params are checked after dispatch. */
export const Envelope = Type.Union([
	Obj({ id: RequestId, method: Str, params: Type.Unknown() }),
	Obj({ method: Str, params: Type.Unknown() }),
	Obj({ id: RequestId, result: Type.Unknown() }),
	Obj({ id: RequestId, error: ResponseError }),
]);
export interface Request {
	id: RequestId;
	method: string;
	params: unknown;
}
export interface Notification {
	method: string;
	params: unknown;
}
export type Response = { id: RequestId; result: unknown } | { id: RequestId; error: ResponseError };
export type Message = Request | Notification | Response;

export const ApprovalMode = Type.Union([Type.Literal("ask"), Type.Literal("autoEdit"), Type.Literal("fullAccess")]);
export type ApprovalMode = Static<typeof ApprovalMode>;

export const ThinkingLevel = Type.Union([
	Type.Literal("off"),
	Type.Literal("minimal"),
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("xhigh"),
	Type.Literal("max"),
]);
export type ThinkingLevel = Static<typeof ThinkingLevel>;

export const ModelRef = Obj({ provider: Str, id: Str, name: Str, contextWindow: Num });
export type ModelRef = Static<typeof ModelRef>;
export const ModelSelector = Obj({ provider: Str, id: Str });
export type ModelSelector = Static<typeof ModelSelector>;
export const ImageRef = Obj({ mimeType: Str, data: Str });
export type ImageRef = Static<typeof ImageRef>;
export const ToolOutput = Type.Union([
	Obj({ type: Type.Literal("text"), text: Str }),
	Obj({ type: Type.Literal("image"), mimeType: Str, data: Str }),
]);
export type ToolOutput = Static<typeof ToolOutput>;

export const ThreadStatus = Type.Union([Type.Literal("notLoaded"), Type.Literal("idle"), Type.Literal("active")]);
/** Phase A has local workspaces only; Phase B adds worktrees. */
export const Workspace = Obj({ mode: Type.Literal("local") });

export const ThreadSummary = Obj({
	id: Str,
	cwd: Str,
	projectCwd: Str,
	name: Str,
	status: ThreadStatus,
	archived: Bool,
	updatedAt: Str,
});
export type ThreadSummary = Static<typeof ThreadSummary>;

export const Thread = Obj({
	id: Str,
	cwd: Str,
	projectCwd: Str,
	name: Str,
	status: ThreadStatus,
	archived: Bool,
	updatedAt: Str,
	workspace: Workspace,
	approvalMode: ApprovalMode,
	model: Type.Optional(ModelRef),
	thinkingLevel: ThinkingLevel,
});
export type Thread = Static<typeof Thread>;

export const FileChange = Obj({
	path: Str,
	kind: Type.Union([Type.Literal("add"), Type.Literal("modify"), Type.Literal("delete")]),
});
export type FileChange = Static<typeof FileChange>;

export const ToolCallStatus = Type.Union([
	Type.Literal("pending"),
	Type.Literal("running"),
	Type.Literal("completed"),
	Type.Literal("failed"),
	Type.Literal("declined"),
]);
export type ToolCallStatus = Static<typeof ToolCallStatus>;

export const Item = Type.Union([
	Obj({ type: Type.Literal("userMessage"), id: Str, text: Str, images: Type.Array(ImageRef) }),
	Obj({ type: Type.Literal("agentMessage"), id: Str, text: Str }),
	Obj({ type: Type.Literal("reasoning"), id: Str, text: Str }),
	Obj({
		type: Type.Literal("toolCall"),
		id: Str,
		tool: Str,
		input: Type.Unknown(),
		status: ToolCallStatus,
		output: Type.Array(ToolOutput),
		parentItemId: Type.Optional(Str),
		/** Set on completion for `edit` and `write`; part of the call, so it has no position of its own (§4.2). */
		fileChanges: Type.Optional(Type.Array(FileChange)),
	}),
	Obj({ type: Type.Literal("compaction"), id: Str, summary: Str }),
	Obj({ type: Type.Literal("extensionMessage"), id: Str, extension: Str, text: Str }),
]);
export type Item = Static<typeof Item>;

export const TurnStatus = Type.Union([
	Type.Literal("inProgress"),
	Type.Literal("completed"),
	Type.Literal("interrupted"),
	Type.Literal("failed"),
]);
export const Turn = Obj({
	id: Str,
	threadId: Str,
	status: TurnStatus,
	error: Type.Optional(Str),
	items: Type.Array(Item),
});
export type Turn = Static<typeof Turn>;

export const PayloadRef = Obj({ id: Str, byteLength: Type.Integer({ minimum: 0 }) });
export type PayloadRef = Static<typeof PayloadRef>;
export const ItemReference = Obj({
	type: Type.Literal("itemReference"), id: Str,
	itemType: Type.Union([
		Type.Literal("userMessage"), Type.Literal("agentMessage"), Type.Literal("reasoning"),
		Type.Literal("toolCall"), Type.Literal("compaction"), Type.Literal("extensionMessage"),
	]),
	payload: PayloadRef,
});
export const WireItem = Type.Union([Item, ItemReference]);
export type WireItem = Static<typeof WireItem>;
export const TurnSummary = Obj({ id: Str, threadId: Str, status: TurnStatus, error: Type.Optional(Type.String({ maxLength: 2000 })) });
export type TurnSummary = Static<typeof TurnSummary>;
export const TurnReference = Obj({ id: Str, threadId: Str, status: TurnStatus, error: Type.Optional(Type.String({ maxLength: 2000 })), payload: PayloadRef });
export const WireTurn = Type.Union([Turn, TurnReference]);
export type WireTurn = Static<typeof WireTurn>;
export const TurnStartResult = Obj({
	status: Type.Union([Type.Literal("started"), Type.Literal("handled"), Type.Literal("cancelled")]),
	threadId: Str, requestId: Str,
});
export type TurnStartResult = Static<typeof TurnStartResult>;

const ModelInfo = Obj({
	provider: Str,
	providerName: Str,
	id: Str,
	name: Str,
	contextWindow: Num,
	maxTokens: Num,
	reasoning: Bool,
	input: Type.Array(Type.Union([Type.Literal("text"), Type.Literal("image")])),
});
const AuthKind = Type.Union([Type.Literal("oauth"), Type.Literal("api_key")]);
const Prompt = Obj({
	type: Str,
	message: Str,
	placeholder: Type.Optional(Str),
	options: Type.Optional(Type.Array(Obj({ id: Str, label: Str, description: Type.Optional(Str) }))),
});
/** Auth events carry URLs, device codes and progress text, never an entered secret. */
const AuthEvent = Type.Record(Str, Type.Unknown());
export const LoginState = Type.Union([
	Obj({
		status: Type.Literal("pending"),
		loginId: Str,
		events: Type.Array(AuthEvent),
		pendingPrompt: Type.Optional(Obj({ id: Str, prompt: Prompt })),
	}),
	Obj({ status: Type.Literal("complete"), loginId: Str, events: Type.Array(AuthEvent) }),
	Obj({ status: Type.Literal("failed"), loginId: Str, events: Type.Array(AuthEvent), error: Str }),
]);
export type LoginState = Static<typeof LoginState>;

const TurnInput = Obj({ threadId: Str, text: Str, images: Type.Optional(Type.Array(ImageRef)) });

export const ClientRequests = {
	initialize: {
		params: Obj({
			clientInfo: Obj({ name: Str, version: Str }),
			protocolVersion: Num,
			capabilities: Obj({ localHandles: Type.Optional(Bool) }),
		}),
		result: Obj({ serverInfo: Obj({ name: Type.Literal("knightcode"), version: Str }), protocolVersion: Num }),
	},
	"thread/start": {
		params: Obj({
			cwd: Str,
			workspace: Type.Optional(Workspace),
			approvalMode: Type.Optional(ApprovalMode),
			model: Type.Optional(ModelSelector),
			thinkingLevel: Type.Optional(ThinkingLevel),
		}),
		result: Obj({ thread: Thread }),
	},
	"thread/resume": {
		params: Obj({ threadId: Str, cursor: Type.Optional(Str) }),
		result: Obj({ thread: Thread, turns: Type.Array(WireTurn), runningTurn: Type.Optional(WireTurn), nextCursor: Type.Optional(Str) }),
	},
	"thread/fork": { params: Obj({ threadId: Str, atItemId: Type.Optional(Str) }), result: Obj({ thread: Thread }) },
	"thread/list": {
		params: Obj({ cwd: Type.Optional(Str), cursor: Type.Optional(Str), archived: Type.Optional(Bool) }),
		result: Obj({ threads: Type.Array(ThreadSummary), nextCursor: Type.Optional(Str) }),
	},
	"thread/read": {
		params: Obj({ threadId: Str, cursor: Type.Optional(Str) }),
		// `Thread` when the thread is loaded; `ThreadSummary` when it is not: workspace, approval mode, model and
		// thinking level live in session state that only a load restores (§4.4).
		result: Obj({
			thread: Type.Union([Thread, ThreadSummary]),
			turns: Type.Array(WireTurn),
			runningTurn: Type.Optional(WireTurn),
			nextCursor: Type.Optional(Str),
		}),
	},
	"thread/unsubscribe": { params: ThreadId, result: Empty },
	"thread/archive": { params: ThreadId, result: Empty },
	"thread/unarchive": { params: ThreadId, result: Empty },
	"thread/name/set": { params: Obj({ threadId: Str, name: Str }), result: Empty },
	"thread/settings/update": {
		params: Obj({
			threadId: Str,
			model: Type.Optional(ModelSelector),
			thinkingLevel: Type.Optional(ThinkingLevel),
			approvalMode: Type.Optional(ApprovalMode),
		}),
		result: Obj({ thread: Thread }),
	},
	"thread/compact": { params: Obj({ threadId: Str, instructions: Type.Optional(Str) }), result: Empty },
	"turn/start": {
		params: Obj({ threadId: Str, text: Str, images: Type.Optional(Type.Array(ImageRef)), requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) }),
		result: TurnStartResult,
	},
	"payload/read": {
		params: Obj({ id: Str, offset: Type.Integer({ minimum: 0 }), maxBytes: Type.Optional(Type.Integer({ minimum: 1, maximum: 49152 })) }),
		result: Obj({ data: Str, nextOffset: Type.Optional(Type.Integer({ minimum: 0 })), eof: Bool }),
	},
	"turn/steer": { params: TurnInput, result: Empty },
	"turn/followUp": { params: TurnInput, result: Empty },
	"turn/interrupt": { params: ThreadId, result: Empty },
	"model/list": {
		params: Empty,
		result: Obj({ models: Type.Array(ModelInfo), default: Type.Union([Str, Type.Null()]) }),
	},
	"command/list": { params: ThreadId, result: Obj({ commands: Type.Array(Obj({ name: Str, description: Str })) }) },
	"config/read": { params: Obj({ cwd: Type.Optional(Str) }), result: Obj({ settings: Type.Unknown() }) },
	"account/list": {
		params: Empty,
		result: Obj({
			accounts: Type.Array(Obj({ provider: Str, providerName: Str, type: AuthKind, isSubscription: Bool })),
			loginOptions: Type.Array(
				Obj({ provider: Str, providerName: Str, type: AuthKind, label: Str, isSubscription: Bool }),
			),
		}),
	},
	"account/login/start": { params: Obj({ provider: Str, type: AuthKind }), result: Obj({ loginId: Str }) },
	"account/login/answer": { params: Obj({ loginId: Str, value: Str }), result: Empty },
	"account/login/cancel": { params: Obj({ loginId: Str }), result: Empty },
	"account/logout": { params: Obj({ provider: Str }), result: Empty },
} as const;

export const ClientNotifications = { initialized: Empty } as const;

/**
 * `index`: the item's position among its turn's top-level items, as in thread/read (§4.2). Provisional on
 * item/started for a streaming item, final on item/completed. Absent for nested calls (`parentItemId`).
 */
const ItemEvent = Obj({ threadId: Str, turnId: Str, item: WireItem, index: Type.Optional(Num) });
const Delta = Obj({ threadId: Str, turnId: Str, itemId: Str, delta: Str });

export const ServerNotifications = {
	"thread/started": Obj({ thread: Thread }),
	"thread/replaced": Obj({ oldThreadId: Str, thread: Thread }),
	"thread/status/changed": Obj({ threadId: Str, status: ThreadStatus }),
	"thread/name/updated": Obj({ threadId: Str, name: Str }),
	"thread/settings/updated": Obj({ thread: Thread }),
	"thread/archived": Obj({ threadId: Str, archived: Bool }),
	"turn/started": Obj({ turn: Turn, requestId: Type.Optional(Str) }),
	"turn/completed": Obj({ turn: TurnSummary }),
	"turn/retry": Obj({ threadId: Str, turnId: Str, attempt: Num, maxAttempts: Num, delayMs: Num, error: Str }),
	"turn/queue/updated": Obj({ threadId: Str, steering: Type.Array(Str), followUp: Type.Array(Str) }),
	"item/started": ItemEvent,
	"item/completed": ItemEvent,
	/** A streamed item whose block the finalized message no longer has (a message_end handler replaced it). */
	"item/removed": Obj({ threadId: Str, turnId: Str, itemId: Str }),
	"item/agentMessage/delta": Delta,
	"item/reasoning/delta": Delta,
	"item/toolCall/outputDelta": Obj({ threadId: Str, turnId: Str, itemId: Str, output: Type.Union([Type.Array(ToolOutput), PayloadRef]) }),
	"serverRequest/cancelled": Obj({ id: RequestId }),
	"account/login/updated": LoginState,
	"account/updated": Obj({ provider: Str, authenticated: Bool }),
	error: Obj({ message: Str, threadId: Type.Optional(Str) }),
} as const;

export const ApprovalDecision = Type.Union([
	Type.Literal("accept"),
	Type.Literal("acceptForSession"),
	Type.Literal("decline"),
	Type.Literal("cancel"),
]);
export type ApprovalDecision = Static<typeof ApprovalDecision>;

export const ServerRequests = {
	"item/toolCall/requestApproval": {
		params: Type.Union([
			Obj({ threadId: Str, turnId: Str, itemId: Str, tool: Str, input: Type.Unknown(), parentItemId: Type.Optional(Str) }),
			Obj({ threadId: Str, turnId: Str, itemId: Str, tool: Str, inputRef: PayloadRef, parentItemId: Type.Optional(Str) }),
		]),
		result: Obj({ decision: ApprovalDecision }),
	},
} as const;

export type ClientMethod = keyof typeof ClientRequests;
export type ParamsOf<M extends ClientMethod> = Static<(typeof ClientRequests)[M]["params"]>;
export type ResultOf<M extends ClientMethod> = Static<(typeof ClientRequests)[M]["result"]>;
export type NotificationMethod = keyof typeof ServerNotifications;
export type NotificationParams<M extends NotificationMethod> = Static<(typeof ServerNotifications)[M]>;
export type ServerRequestMethod = keyof typeof ServerRequests;
export type ServerRequestParams<M extends ServerRequestMethod> = Static<(typeof ServerRequests)[M]["params"]>;
export type ServerRequestResult<M extends ServerRequestMethod> = Static<(typeof ServerRequests)[M]["result"]>;

/** The JSON Schema document written to packages/cli/docs/app-server.schema.json. */
export function schemaDocument() {
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		title: "KnightCode app server protocol",
		protocolVersion: PROTOCOL_VERSION,
		envelope: Envelope,
		clientRequests: ClientRequests,
		clientNotifications: ClientNotifications,
		serverNotifications: ServerNotifications,
		serverRequests: ServerRequests,
	};
}
```

`packages/app-server-protocol/src/index.ts`:

```ts
export * from "./protocol.ts";
```

`packages/app-server-protocol/scripts/generate-schema.ts`:

```ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { schemaDocument } from "../src/index.ts";

const target = join(import.meta.dirname, "../../cli/docs/app-server.schema.json");
writeFileSync(target, `${JSON.stringify(schemaDocument(), null, "\t")}\n`);
console.log(`wrote ${target}`);
```

- [ ] **Step 5: Generate the schema and run the test**

Run: `cd packages/app-server-protocol && bun run generate:schema && bun x vitest --run test/protocol.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Type check and commit**

Run: `bun run check-types` (repo root). Expected: no errors.

```bash
git add packages/app-server-protocol/package.json packages/app-server-protocol/tsconfig.json packages/app-server-protocol/vitest.config.ts packages/app-server-protocol/src/protocol.ts packages/app-server-protocol/src/index.ts packages/app-server-protocol/scripts/generate-schema.ts packages/app-server-protocol/test/protocol.test.ts tsconfig.json packages/cli/package.json bun.lock AGENTS.md packages/cli/docs/app-server.schema.json
git commit -m "feat(app-server-protocol): add the app server protocol schemas"
```

`bun.lock` only gains the workspace package; no external package changes, so the pre-commit lockfile guard does not fire. If it does, stop and ask the user.

---

### Task 2: Session files: reads that never write, canonical ownership, and the write contract

**Files:**
- Create: `packages/cli/src/core/session-lock.ts`, `packages/cli/test/session-lock.test.ts`, `packages/cli/test/session-lock-process.test.ts`, `packages/cli/test/session-manager-lock.test.ts`, `packages/cli/test/fixtures/take-session-lock.ts`, `packages/cli/test/fixtures/stall-session-lock.ts`
- Modify: `packages/cli/src/core/session-manager.ts` (`loadEntriesFromFile` `:617-661`, fields near `:978-989`, `_setSessionFile` `:1020-1046`, `newSession` `:1048-1074`, `_rewriteFile` `:1118-1128`, `_persist` `:1166-1183`, `_appendEntry` `:1185-1190`, `branch` `:1573`, `resetLeaf` `:1585`, `branchWithSummary` `:1594-1619`, `createBranchedSession` `:1626-1721`, `forkFrom` `:1809-1860`), `packages/cli/src/core/agent-session.ts` (`dispose` `:1425-1446`), `packages/cli/test/suite/agent-session-runtime.test.ts`

**Interfaces:**
- Produces, from `core/session-lock.ts`:
  - `class SessionLockedError extends Error { readonly sessionFile: string }`, `class SessionHardLinkedError extends Error { readonly sessionFile: string }`
  - `interface SessionLock { readonly lost: boolean; covers(sessionFile: string): boolean; release(): void }`
  - `interface LockTiming { staleMs: number; updateMs: number }`
  - `canonicalSessionPath(sessionFile: string): string`
  - `acquireSessionLock(sessionFile: string, timing?: LockTiming): SessionLock`
  - `configureSessionLocks(timing: LockTiming): void` (the default timing for managers; tests only)
- Produces, from `core/session-manager.ts`: `class SessionClosedError extends Error`, `class SessionLockLostError extends Error`, `SessionManager.close(): void`, `SessionManager.hasLostLock(): boolean`. `SessionManager.open`, `continueRecent`, `forkFrom` and the constructor throw `SessionLockedError` when another process holds the file. `loadEntriesFromFile` never writes.
- `AgentSession.dispose()` closes its session manager.

The contract is §5.5. Five rules drive every edit below:

1. A persisted manager owns its canonical selected destination, even before the file exists. New/branched destinations are staged and locked before committing manager state; close releases ownership. This replaces the first-flush-only proposal so no selected manager can be writable without a lock. `forkFrom` locks before writing its copy.
2. Every path that writes the file or moves the tree checks, before it changes memory or disk, that the manager is open and still owns the file. Ownership is read synchronously from the owner token at each check, not taken from a flag a refresh timer sets later: a stalled process must not write after another process took over.
3. `close()` is final: the manager stays readable and rejects writes.
4. Reading never writes. The trailing-newline repair moves from `loadEntriesFromFile` into the manager, after the lock is taken.
5. Nothing removes or refreshes a lock directory without first checking the token, including proper-lockfile's own exit cleanup and refresh timer.

The inventory for rule 2, taken from `session-manager.ts` (every assignment to `fileEntries`, `leafId`, `labelsById`, and every `openSync`/`writeFileSync`/`appendFileSync`):

| Path | Writes | Guard |
| --- | --- | --- |
| `appendMessage`, `appendThinkingLevelChange`, `appendModelChange`, `appendUsage`, `appendCompaction`, `appendCustomEntry`, `appendSessionInfo`, `appendCustomMessageEntry`, `appendContextEdit`, `appendLabelChange` | memory, then `_persist` | `_appendEntry` checks first; each builds its entry without touching state before that call, and `appendLabelChange` updates its label maps only after `_appendEntry` returned |
| `_persist` first flush | creates the file | asserts ownership (held since the destination was selected, rule 1), then `wx` |
| `_rewriteFile` (migration, empty-file header, branching) | rewrites the file | checks first |
| `branch`, `resetLeaf` | leaf only | check first (the next append builds on the leaf) |
| `branchWithSummary` | leaf, then an append | checks before moving the leaf: today the leaf moves before `_appendEntry` could refuse |
| `newSession`, `setSessionFile` | memory, a new file name | check first |
| `createBranchedSession` | memory, a new file | checks first; new lock, then memory and the lock together, then rewrite, then old lock released; rolls back on failure |
| `forkFrom` (static) | a new file | locks the destination, writes it (or only the path to `leafId`) in one `wx` write, then builds the manager |
| `loadEntriesFromFile` | nothing (repair moved) | none needed |

Confirm the table against the file before editing (`rg -n "this\.(fileEntries|leafId) =|this\.fileEntries\.push|labelsById\.(set|delete)|writeFileSync|appendFileSync|openSync" packages/cli/src/core/session-manager.ts`); a path not in it gets the same guard.

Within one process the lock is shared and counted: `AgentSessionRuntime.fork` (`agent-session-runtime.ts:332`) briefly opens a second manager on the live file. Each acquisition gets its own handle, so releasing an old handle can never release a newer acquisition of the same file.

- [ ] **Step 1: Write the failing lock-module test**

`packages/cli/test/session-lock.test.ts`. Refresh behaviour runs under fake timers: proper-lockfile schedules its refresh with `setTimeout` and, with `lockSync`, runs the whole refresh synchronously inside that callback, so `vi.advanceTimersByTime` drives it deterministically. "Another process" in this file is a lock directory and owner token written directly, never a second `proper-lockfile` lock in the same process: both would share proper-lockfile's module-level lock table, which two real processes never do. Task 2's process test covers a real second process.

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { acquireSessionLock, SessionLockedError } from "../src/core/session-lock.ts";

// proper-lockfile's minimums: stale 2000 ms, update 1000 ms.
const FAST = { staleMs: 2_000, updateMs: 1_000 };
const dirs: string[] = [];
beforeEach(() => {
	// Before any acquisition, so proper-lockfile's refresh timers are fake too.
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
	vi.useRealTimers();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function sessionFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "knightcode-lock-"));
	dirs.push(dir);
	const file = join(dir, "s.jsonl");
	writeFileSync(file, "");
	return file;
}

const isLocked = (file: string) => lockfile.checkSync(file, { realpath: false });

/** Another process took the expired lock: a fresh lock directory and its own owner token. */
function takeOver(file: string): void {
	rmSync(`${file}.lock`, { recursive: true, force: true });
	mkdirSync(`${file}.lock`);
	writeFileSync(`${file}.lock-owner`, "another-process");
}

test("a second holder is refused, and one process shares a counted lock", () => {
	const file = sessionFile();
	const first = acquireSessionLock(file, FAST);
	const second = acquireSessionLock(file, FAST);
	first.release();
	expect(isLocked(file)).toBe(true);
	second.release();
	expect(isLocked(file)).toBe(false);
	mkdirSync(`${file}.lock`);
	expect(() => acquireSessionLock(file, FAST)).toThrow(SessionLockedError);
});

test("a takeover is caught at the next check, before any refresh runs, and release leaves the new holder alone", () => {
	const file = sessionFile();
	const ours = acquireSessionLock(file, FAST);
	expect(ours.lost).toBe(false);
	// Synchronous on purpose: no refresh timer has run.
	takeOver(file);
	expect(ours.lost).toBe(true);
	ours.release();
	expect(existsSync(`${file}.lock`)).toBe(true);
	expect(readFileSync(`${file}.lock-owner`, "utf8")).toBe("another-process");
});

test("a refresh after a takeover leaves the new holder's lock directory untouched", () => {
	const file = sessionFile();
	const ours = acquireSessionLock(file, FAST);
	takeOver(file);
	const before = statSync(`${file}.lock`).mtimeMs;
	// The refresh finds the directory is not ours (by mtime or by token) and reports a compromise; the
	// re-take finds a fresh lock and fails.
	vi.advanceTimersByTime(FAST.updateMs);
	expect(statSync(`${file}.lock`).mtimeMs).toBe(before);
	expect(ours.lost).toBe(true);
	ours.release();
	expect(existsSync(`${file}.lock`)).toBe(true);
});

test("a refresh that runs late keeps the lock when nobody took it", () => {
	const file = sessionFile();
	const lock = acquireSessionLock(file, FAST);
	// A sleeping laptop: the clock jumps past the stale threshold before the refresh runs. proper-lockfile
	// renews a late lock whose mtime is still its own, so no recovery is needed; this pins that.
	vi.setSystemTime(Date.now() + FAST.staleMs + 500);
	vi.advanceTimersByTime(FAST.updateMs);
	expect(lock.lost).toBe(false);
	expect(isLocked(file)).toBe(true);
	lock.release();
	expect(isLocked(file)).toBe(false);
});

test("a lock directory deleted under us is taken again", () => {
	const file = sessionFile();
	const lock = acquireSessionLock(file, FAST);
	rmSync(`${file}.lock`, { recursive: true, force: true });
	// The refresh fails with ENOENT, proper-lockfile reports a compromise, and nobody else holds it.
	vi.advanceTimersByTime(FAST.updateMs);
	expect(lock.lost).toBe(false);
	expect(isLocked(file)).toBe(true);
	lock.release();
});

test("an acquisition whose owner token cannot be written leaves no lock and no refresh timer", () => {
	const file = sessionFile();
	// A directory where the token file goes makes writeFileSync fail (EISDIR, or EPERM on Windows) after
	// lockSync has already succeeded.
	mkdirSync(`${file}.lock-owner`);
	expect(() => acquireSessionLock(file, FAST)).toThrow();
	expect(existsSync(`${file}.lock`)).toBe(false);
	expect(vi.getTimerCount()).toBe(0);
	rmSync(`${file}.lock-owner`, { recursive: true });
	const lock = acquireSessionLock(file, FAST);
	expect(lock.lost).toBe(false);
	lock.release();
});

test("a deleted session directory loses the lock without crashing or recreating the directory", () => {
	const file = sessionFile();
	const lock = acquireSessionLock(file, FAST);
	rmSync(join(file, ".."), { recursive: true, force: true });
	vi.advanceTimersByTime(FAST.updateMs);
	expect(lock.lost).toBe(true);
	expect(existsSync(join(file, ".."))).toBe(false);
	expect(() => lock.release()).not.toThrow();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/session-lock.test.ts`
Expected: FAIL, cannot resolve `../src/core/session-lock.ts`.

- [ ] **Step 3: Write the lock module**

Why a token file: `lost` cannot rely on proper-lockfile's refresh alone. If this process's event loop stalls past the stale threshold, another process may take the lock, and this process can append (or release, removing the other's lock directory) before its next refresh notices. So each acquisition writes a random token to `<file>.lock-owner`, and every write and every release first reads it back: a different token means another process holds the file. The token lives beside the lock directory, not inside it, because proper-lockfile removes a stale lock with a plain `rmdir`, which fails on a non-empty directory. The check is one small synchronous read per write; a takeover that lands in the microseconds between the check and the append is not prevented (§5.5 states this limit).

Why a guarded `fs`: our `release()` is not the only code that removes or touches the lock directory. proper-lockfile registers a process-exit handler (`signal-exit`, `lib/lockfile.js` bottom) that `rmdirSync`s every lock still in its table, and its refresh timer `utimes` the directory. Neither knows the token. The probe that found this: A holds the lock, B takes it over, A sees `lost`, skips its release, exits, and the exit handler deletes B's directory. proper-lockfile takes an `fs` option (typed `fs?: any` in `@types/proper-lockfile`) and routes every filesystem call through it; with `lockSync`, `lib/adapter.js` `createSyncFs` maps `rmdir` and `utimes` to that object's `rmdirSync` and `utimesSync`, and the exit handler calls `options.fs.rmdirSync` directly. So each acquisition passes its own `fs` whose `rmdirSync` does nothing and whose `utimesSync` fails with `ENOENT` once the token is not its own. A refresh that hits that failure reports a compromise, `onCompromised` tries to re-take, finds the other holder's fresh lock, and marks the handle lost. The guard is off while `lockSync` itself runs: removing a stale lock and probing mtime precision happen before this acquisition has a token.

`packages/cli/src/core/session-lock.ts`:

```ts
/**
 * Cross-process lock on a live session file (app server §5.5).
 *
 * Two processes appending to one JSONL file interleave entries and corrupt
 * the tree. The desktop app's app server and a terminal CLI are two such
 * processes. The lock is a `proper-lockfile` directory beside the file,
 * refreshed while held so a crashed holder's lock goes stale, plus an owner
 * token file that writers check synchronously: a stalled event loop can miss
 * a takeover until its next refresh, and must not write or release meanwhile.
 * proper-lockfile's own removal and refresh (its unlock, its exit handler, its
 * refresh timer) go through an `fs` that checks the same token.
 *
 * Within one process the lock is shared and counted: the runtime's fork path
 * opens a second manager on the live file for a moment. Each acquisition
 * gets its own handle, bound to the underlying lock it counted on.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import lockfile from "proper-lockfile";

export interface LockTiming {
	staleMs: number;
	updateMs: number;
}

let defaultTiming: LockTiming = { staleMs: 30_000, updateMs: 10_000 };

/** Tests shorten the timing so compromise and recovery happen in seconds. */
export function configureSessionLocks(timing: LockTiming): void {
	defaultTiming = timing;
}

export class SessionLockedError extends Error {
	readonly sessionFile: string;

	constructor(sessionFile: string) {
		super(`Session is open in another KnightCode process: ${sessionFile}`);
		this.name = "SessionLockedError";
		this.sessionFile = sessionFile;
	}
}

export interface SessionLock {
	/** Checked against the owner token on every read: true once another process holds the file. */
	readonly lost: boolean;
	/** Whether this lock is for `sessionFile` (a canonical path). A manager writes only the file its lock covers. */
	covers(sessionFile: string): boolean;
	/** Idempotent. Never touches a newer acquisition, or another process's lock. */
	release(): void;
}

/**
 * The transcript has more than one name (a hard link). Ownership by path cannot cover both names, so it is
 * refused. An archive move interrupted between its link and its unlink leaves exactly this (§5.8).
 */
export class SessionHardLinkedError extends Error {
	readonly sessionFile: string;

	constructor(sessionFile: string) {
		super(`Session file has more than one name (hard link); resolve the duplicate before opening it: ${sessionFile}`);
		this.name = "SessionHardLinkedError";
		this.sessionFile = sessionFile;
	}
}

interface Held {
	count: number;
	lost: boolean;
	token: string;
	unlock: () => void;
}

const held = new Map<string, Held>();

/** Existing files resolve through aliases; a new file resolves through its existing parent. */
export function canonicalSessionPath(sessionFile: string): string {
	const absolute = resolve(sessionFile);
	try {
		return fs.realpathSync.native(absolute);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		// A dangling symlink is not a new destination.
		try {
			if (fs.lstatSync(absolute).isSymbolicLink()) throw error;
		} catch (statError) {
			if (statError === error || (statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
		}
		return join(fs.realpathSync.native(dirname(absolute)), basename(absolute));
	}
}

/** Canonical Windows map keys compare case-insensitively; disk paths keep their actual spelling. */
function keyOf(sessionFile: string): string {
	return process.platform === "win32" ? sessionFile.toLowerCase() : sessionFile;
}

const ownerFile = (sessionFile: string) => `${sessionFile}.lock-owner`;

function tokenOnDisk(sessionFile: string): string | undefined {
	try {
		return fs.readFileSync(ownerFile(sessionFile), "utf8");
	} catch {
		return undefined;
	}
}

/**
 * The fs proper-lockfile uses for one acquisition. Once `owns()` says another holder has the file,
 * removing the lock directory does nothing and refreshing it fails as if it were gone (§5.5).
 */
function guardedFs(owns: () => boolean): typeof fs {
	return {
		...fs,
		rmdirSync: ((path: fs.PathLike, options?: fs.RmDirOptions) => {
			if (owns()) fs.rmdirSync(path, options);
		}) as typeof fs.rmdirSync,
		utimesSync: ((path: fs.PathLike, atime: fs.TimeLike, mtime: fs.TimeLike) => {
			if (!owns()) throw Object.assign(new Error(`lock taken by another holder: ${String(path)}`), { code: "ENOENT" });
			fs.utimesSync(path, atime, mtime);
		}) as typeof fs.utimesSync,
	};
}

/**
 * Take the lock and stamp it with a fresh token. Does not create the session directory: a lock whose
 * directory was deleted is lost, not silently recreated.
 */
function take(sessionFile: string, timing: LockTiming, entry: Held, onCompromised: () => void): void {
	const token = `${process.pid}-${randomUUID()}`;
	// Off while lockSync runs: removing a stale lock and probing mtime precision come before our token exists.
	let armed = false;
	const owns = () => !armed || tokenOnDisk(sessionFile) === token;
	try {
		entry.unlock = lockfile.lockSync(sessionFile, {
			realpath: false,
			stale: timing.staleMs,
			update: timing.updateMs,
			onCompromised,
			fs: guardedFs(owns),
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOCKED") throw new SessionLockedError(sessionFile);
		throw error;
	}
	try {
		fs.writeFileSync(ownerFile(sessionFile), token);
	} catch (error) {
		// Without a token nothing can prove ownership, and the lock would stay held (and refreshed) by an
		// acquisition that failed. Give it back before failing; the guard is still off, so this removes it.
		try {
			entry.unlock();
		} catch {
			// Already gone.
		}
		throw error;
	}
	entry.token = token;
	armed = true;
}

function createHeld(sessionFile: string, key: string, timing: LockTiming): Held {
	const entry: Held = { count: 0, lost: false, token: "", unlock: () => {} };
	// proper-lockfile gives the lock up when a refresh fails: its directory was deleted (ENOENT), another
	// process replaced it (the mtime is not ours), or the guarded fs refused (the token is not ours). A
	// refresh that merely runs late, with the mtime still ours, is renewed by proper-lockfile itself. The
	// default handler throws from a timer and kills the process; take the lock again instead, which fails
	// if another process holds it or the session directory is gone.
	const onCompromised = () => {
		if (entry.count === 0 || entry.lost) return;
		try {
			take(sessionFile, timing, entry, onCompromised);
		} catch {
			entry.lost = true;
			if (held.get(key) === entry) held.delete(key);
		}
	};
	take(sessionFile, timing, entry, onCompromised);
	return entry;
}

/** Lock one canonical filesystem identity. Its directory must exist. */
export function acquireSessionLock(sessionFile: string, timing: LockTiming = defaultTiming): SessionLock {
	sessionFile = canonicalSessionPath(sessionFile);
	if (fs.existsSync(sessionFile) && fs.statSync(sessionFile).nlink > 1) throw new SessionHardLinkedError(sessionFile);
	const key = keyOf(sessionFile);
	let entry = held.get(key);
	if (!entry) {
		entry = createHeld(sessionFile, key, timing);
		held.set(key, entry);
	}
	const owned = entry;
	owned.count++;
	const check = () => {
		if (!owned.lost && tokenOnDisk(sessionFile) !== owned.token) {
			owned.lost = true;
			if (held.get(key) === owned) held.delete(key);
		}
		return owned.lost;
	};
	let released = false;
	return {
		get lost() {
			return check();
		},
		covers: (file) => keyOf(file) === key,
		release() {
			if (released) return;
			released = true;
			if (--owned.count > 0) return;
			if (held.get(key) === owned) held.delete(key);
			// A lost lock stays in proper-lockfile's table until its refresh reports the compromise; the
			// guarded fs makes that refresh, and the exit handler, leave the other holder's directory alone.
			if (check()) return;
			try {
				owned.unlock();
				fs.rmSync(ownerFile(sessionFile), { force: true });
			} catch {
				// Already gone (the directory was deleted); released is what the caller wanted.
			}
		},
	};
}
```

Add alias regressions to `session-lock.test.ts` and `session-lock-process.test.ts`: a file symlink, a directory symlink (junction on Windows), and an uncreated destination under an aliased parent all use one canonical lock directory/token. In one process, acquisitions count onto one held entry; in two processes, the second throws `SessionLockedError` until release. Test Windows case aliases. Use junctions without elevation; file-symlink tests may explicitly skip on `EPERM`/`EACCES` where Windows lacks Developer Mode, but must run in enabled CI. Refuse dangling symlinks and transcripts with two hard links. Assert no alias-specific sidecar was created. Canonicalize manager binding too, so alias retargeting does not redirect writes.

Every caller locks a file whose directory exists: the manager's constructor creates its session directory, `forkFrom` creates the target directory before locking, and the archive move (Task 10) locks a file it just found. `take` therefore does not create directories, which is what makes a deleted session directory read as a lost lock.

- [ ] **Step 4: Write the two-process tests**

The in-process tests cannot show proper-lockfile's exit handler at work, because the test process does not exit. `packages/cli/test/fixtures/stall-session-lock.ts`, run as a separate process:

```ts
/**
 * Holds a session file's lock, then stalls its event loop until the gate file exists, as a process
 * whose laptop slept would. Then exits, after releasing (`release`) or without (`exit`).
 */
import { existsSync } from "node:fs";
import { acquireSessionLock } from "../../src/core/session-lock.ts";

const [file, gate, mode] = process.argv.slice(2);
const lock = acquireSessionLock(file, { staleMs: 2_000, updateMs: 1_000 });
process.stdout.write("taken\n", () => {
	// Busy-wait: no timer, so no refresh, runs while the lock goes stale.
	while (!existsSync(gate)) {
		// stalled
	}
	process.stdout.write(`lost=${lock.lost}\n`);
	if (mode === "release") lock.release();
	// proper-lockfile's exit handler runs here.
	process.exit(0);
});
```

`packages/cli/test/session-lock-process.test.ts`:

```ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import lockfile from "proper-lockfile";
import { afterEach, expect, test } from "vitest";
import { acquireSessionLock, type SessionLock, SessionLockedError } from "../src/core/session-lock.ts";

const FAST = { staleMs: 2_000, updateMs: 1_000 };
const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Collects `stream`'s lines; `next(text)` resolves when a line equal to `text` has arrived. */
function lines(stream: Readable) {
	const seen: string[] = [];
	const waiters = new Set<() => void>();
	let buffer = "";
	stream.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8");
		const parts = buffer.split("\n");
		buffer = parts.pop() ?? "";
		seen.push(...parts);
		for (const wake of [...waiters]) wake();
	});
	return {
		seen,
		next: (text: string) =>
			new Promise<void>((resolve) => {
				const check = () => {
					if (!seen.includes(text)) return;
					waiters.delete(check);
					resolve();
				};
				waiters.add(check);
				check();
			}),
	};
}

/** Retries until the stalled holder's lock has gone stale and this process takes it. */
async function takeWhenStale(file: string): Promise<SessionLock> {
	const deadline = Date.now() + 10_000;
	for (;;) {
		try {
			return acquireSessionLock(file, FAST);
		} catch (error) {
			if (!(error instanceof SessionLockedError) || Date.now() > deadline) throw error;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}

for (const mode of ["release", "exit"] as const) {
	test(`a stalled holder that exits (${mode}) leaves the new holder's lock in place`, async () => {
		const dir = mkdtempSync(join(tmpdir(), "knightcode-lock-proc-"));
		dirs.push(dir);
		const file = join(dir, "s.jsonl");
		const gate = join(dir, "gate");
		writeFileSync(file, "");
		const child = spawn(process.execPath, [join(import.meta.dirname, "fixtures/stall-session-lock.ts"), file, gate, mode], {
			stdio: ["ignore", "pipe", "inherit"],
		});
		const exited = once(child, "exit");
		const out = lines(child.stdout!);
		await out.next("taken");
		const ours = await takeWhenStale(file);
		try {
			writeFileSync(gate, "");
			await out.next("lost=true");
			await exited;
			expect(lockfile.checkSync(file, { realpath: false })).toBe(true);
			expect(ours.lost).toBe(false);
		} finally {
			ours.release();
		}
	}, 30_000);
}
```

The retry loop in `takeWhenStale` waits for a condition (the lock going stale), with a deadline; it is not a fixed sleep.

- [ ] **Step 5: Run the lock tests**

Run: `cd packages/cli && bun x vitest --run test/session-lock.test.ts test/session-lock-process.test.ts`
Expected: PASS, including the alias regressions added after Step 3. The process tests take a few seconds each: the stale threshold is real time in the child.

If the `exit` variant fails, the guard is not reaching proper-lockfile's exit handler; check that `lockSync` kept the `fs` passed in its options (`toSyncOptions` spreads it into `createSyncFs`).

- [ ] **Step 6: Write the failing `SessionManager` tests**

`packages/cli/test/session-manager-lock.test.ts`:

```ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import lockfile from "proper-lockfile";
import { afterEach, describe, expect, test, vi } from "vitest";
import { canonicalSessionPath, SessionLockedError } from "../src/core/session-lock.ts";
import {
	CURRENT_SESSION_VERSION,
	loadEntriesFromFile,
	SessionClosedError,
	SessionLockLostError,
	SessionManager,
} from "../src/core/session-manager.ts";

/** Resolves when `stream` prints the line `text`. */
function lineFrom(stream: Readable, text: string): Promise<void> {
	return new Promise((resolve) => {
		let buffer = "";
		stream.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			if (buffer.split("\n").includes(text)) resolve();
		});
	});
}

const dirs: string[] = [];
afterEach(() => {
	vi.useRealTimers();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "knightcode-sm-lock-"));
	dirs.push(dir);
	return dir;
}

const user = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }], timestamp: 1 });

function sessionWithConversation(): { dir: string; manager: SessionManager; file: string } {
	const dir = tempDir();
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage(user("hi"));
	manager.appendMessage(user("again"));
	return { dir, manager, file: manager.getSessionFile()! };
}

const isLocked = (file: string) => lockfile.checkSync(file, { realpath: false });

/** Another process took the expired lock (written directly; see session-lock.test.ts). */
function takeOver(file: string): void {
	rmSync(`${file}.lock`, { recursive: true, force: true });
	mkdirSync(`${file}.lock`);
	writeFileSync(`${file}.lock-owner`, "another-process");
}

/** Every path that writes the file or moves the tree (the inventory above). */
const mutations: Array<[string, (m: SessionManager) => unknown]> = [
	["appendMessage", (m) => m.appendMessage(user("x"))],
	["appendCustomEntry", (m) => m.appendCustomEntry("x")],
	["appendLabelChange", (m) => m.appendLabelChange(m.getLeafId()!, "label")],
	["appendSessionInfo", (m) => m.appendSessionInfo("name")],
	["branch", (m) => m.branch(m.getEntries()[0].id)],
	["resetLeaf", (m) => m.resetLeaf()],
	["branchWithSummary", (m) => m.branchWithSummary(m.getEntries()[0].id, "summary")],
	["createBranchedSession", (m) => m.createBranchedSession(m.getLeafId()!)],
	["newSession", (m) => m.newSession()],
	["setSessionFile", (m) => m.setSessionFile(m.getSessionFile()!)],
];

function snapshot(manager: SessionManager, file: string) {
	return {
		leaf: manager.getLeafId(),
		entries: manager.getEntries().map((e) => e.id),
		sessionFile: manager.getSessionFile(),
		disk: readFileSync(file, "utf8"),
	};
}

describe("SessionManager lock", () => {
	test("a new session locks its selected destination before its first flush; close releases it", () => {
		const dir = tempDir();
		const manager = SessionManager.create(dir, dir);
		expect(existsSync(manager.getSessionFile()!)).toBe(false);
		expect(existsSync(`${manager.getSessionFile()}.lock`)).toBe(true);
		manager.appendMessage(user("hi"));
		expect(isLocked(manager.getSessionFile()!)).toBe(true);
		manager.close();
		expect(isLocked(manager.getSessionFile()!)).toBe(false);
	});

	test("opening a file another holder locks throws SessionLockedError", () => {
		const { manager, file } = sessionWithConversation();
		manager.close();
		mkdirSync(`${file}.lock`);
		expect(() => SessionManager.open(file)).toThrow(SessionLockedError);
		rmSync(`${file}.lock`, { recursive: true });
		SessionManager.open(file).close();
	});

	test("two managers in one process share the lock until both close", () => {
		const { manager, file } = sessionWithConversation();
		const second = SessionManager.open(file);
		manager.close();
		expect(isLocked(file)).toBe(true);
		second.close();
		expect(isLocked(file)).toBe(false);
	});

	describe.each([
		["closed", SessionClosedError, (m: SessionManager) => m.close()],
		["lost", SessionLockLostError, (m: SessionManager) => takeOver(m.getSessionFile()!)],
	] as const)("a %s manager", (_state, error, makeUnwritable) => {
		test.each(mutations)("%s throws and changes neither memory nor disk", (_name, mutate) => {
			const { manager, file } = sessionWithConversation();
			makeUnwritable(manager);
			const before = snapshot(manager, file);
			expect(() => mutate(manager)).toThrow(error);
			expect(snapshot(manager, file)).toEqual(before);
		});
	});

	test("a closed manager stays readable and never writes after another holder opens the file", () => {
		const { manager, file } = sessionWithConversation();
		manager.close();
		manager.close();
		expect(manager.getEntries()).toHaveLength(2);
		const other = SessionManager.open(file);
		other.appendMessage(user("from the new holder"));
		const before = readFileSync(file, "utf8");
		expect(() => manager.appendMessage(user("stale writer"))).toThrow(SessionClosedError);
		expect(readFileSync(file, "utf8")).toBe(before);
		other.close();
	});

	test("a lost manager's close leaves the new holder's lock in place", () => {
		const { manager, file } = sessionWithConversation();
		takeOver(file);
		manager.close();
		expect(existsSync(`${file}.lock`)).toBe(true);
		expect(readFileSync(`${file}.lock-owner`, "utf8")).toBe("another-process");
	});

	test("branching moves the lock to the new file", () => {
		const { manager, file } = sessionWithConversation();
		manager.appendCustomEntry("marker");
		const branched = manager.createBranchedSession(manager.getLeafId()!)!;
		expect(isLocked(file)).toBe(false);
		expect(isLocked(branched)).toBe(true);
		manager.close();
	});

	test("forkFrom locks its destination before the file exists", () => {
		const { manager, file, dir } = sessionWithConversation();
		manager.close();
		// A fixed clock makes the destination name predictable: <timestamp>_<id>.jsonl.
		vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const destination = join(dir, `${stamp}_fork-dest.jsonl`);
		// Another holder already has the destination's lock: a fork that wrote before locking would leave
		// the file behind; one that locks first fails before writing anything.
		mkdirSync(`${destination}.lock`);
		expect(() => SessionManager.forkFrom(file, dir, dir, { id: "fork-dest" })).toThrow(SessionLockedError);
		expect(existsSync(destination)).toBe(false);
		rmSync(`${destination}.lock`, { recursive: true });
		const fork = SessionManager.forkFrom(file, dir, dir, { id: "fork-dest" });
		// The manager binds the canonical path: macOS temp dirs live under the /var -> /private/var symlink,
		// and Windows temp paths can be 8.3 short names.
		expect(fork.getSessionFile()).toBe(canonicalSessionPath(destination));
		expect(isLocked(destination)).toBe(true);
		fork.close();
	});

	test("forkFrom at a leaf writes only that path, as one file", () => {
		const { manager, file, dir } = sessionWithConversation();
		const [first] = manager.getEntries();
		manager.branch(first.id);
		manager.appendMessage(user("other branch"));
		const leaf = manager.getLeafId()!;
		manager.close();
		const before = readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
		const fork = SessionManager.forkFrom(file, dir, dir, { leafId: leaf });
		expect(fork.getEntries().map((e) => e.id)).toEqual([first.id, leaf]);
		expect(readdirSync(dir).filter((name) => name.endsWith(".jsonl"))).toHaveLength(before.length + 1);
		fork.close();
		expect(() => SessionManager.forkFrom(file, dir, dir, { leafId: "missing" })).toThrow();
		expect(readdirSync(dir).filter((name) => name.endsWith(".jsonl"))).toHaveLength(before.length + 1);
	});

	test("reading never writes; the owner repairs a missing final newline", () => {
		const { manager, file } = sessionWithConversation();
		manager.close();
		// A crash mid-append leaves the last line without its newline.
		const content = readFileSync(file, "utf8").replace(/\n$/, "");
		writeFileSync(file, content);
		loadEntriesFromFile(file);
		const fork = SessionManager.forkFrom(file, join(file, ".."), join(file, ".."));
		fork.close();
		expect(readFileSync(file, "utf8")).toBe(content);
		SessionManager.open(file).close();
		expect(readFileSync(file, "utf8")).toBe(`${content}\n`);
	});

	test("a file that fails to load after the lock is taken leaves no lock", () => {
		const dir = tempDir();
		const file = join(dir, "2026-10-11T00-00-00-000Z_bad.jsonl");
		// "../escape" passes discovery (readSessionHeader only checks that `id` is a string) and fails
		// assertValidSessionId in _loadEntries, after the lock is taken.
		appendFileSync(
			file,
			`${JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id: "../escape", timestamp: "2026-10-11T00:00:00.000Z", cwd: dir })}\n`,
		);
		expect(() => SessionManager.open(file)).toThrow();
		expect(isLocked(file)).toBe(false);
	});

	test("a manager whose file another process took rejects writes before any refresh, and close leaves their lock", async () => {
		const { manager, file } = sessionWithConversation();
		// The lock expired while this process stalled; another process takes it.
		rmSync(`${file}.lock`, { recursive: true, force: true });
		const child = spawn(process.execPath, [join(import.meta.dirname, "fixtures/take-session-lock.ts"), file], {
			stdio: ["pipe", "pipe", "inherit"],
		});
		try {
			await lineFrom(child.stdout!, "taken");
			const before = readFileSync(file, "utf8");
			expect(() => manager.appendMessage(user("stale writer"))).toThrow(SessionLockLostError);
			expect(readFileSync(file, "utf8")).toBe(before);
			manager.close();
			expect(isLocked(file)).toBe(true);
		} finally {
			child.stdin!.end();
			await once(child, "exit");
		}
	});

	test("an in-memory manager takes no lock and close changes nothing", () => {
		const manager = SessionManager.inMemory();
		manager.appendMessage(user("hi"));
		manager.close();
		expect(() => manager.appendMessage(user("still fine"))).not.toThrow();
	});
});
```

`packages/cli/test/fixtures/take-session-lock.ts`, run as a separate process:

```ts
/** Takes a session file's lock from another process, as a terminal would after the holder's lock expired. */
import { acquireSessionLock } from "../../src/core/session-lock.ts";

const lock = acquireSessionLock(process.argv[2]);
process.stdout.write("taken\n");
process.stdin.resume();
process.stdin.on("end", () => {
	lock.release();
	process.exit(0);
});
```

The fork test fixes `Date` only (`toFake: ["Date"]`), so the destination name is known in advance; `forkFrom` takes its timestamp from `new Date()` (`session-manager.ts:1837`). `CURRENT_SESSION_VERSION` is exported from `session-manager.ts` (`:41`).

- [ ] **Step 7: Run them to verify they fail**

Run: `cd packages/cli && bun x vitest --run test/session-manager-lock.test.ts`
Expected: FAIL, `SessionClosedError` is not exported.

- [ ] **Step 8: Wire the contract into `SessionManager`**

In `session-manager.ts`, import `acquireSessionLock`, `canonicalSessionPath` and `type SessionLock` from `./session-lock.ts`, and `rmSync`, `writeSync` from `node:fs` beside the existing `node:fs` imports (add only those not already imported).

Add the errors near the other exported errors:

```ts
/** A write to a manager after close(). Reopen the file with a new manager instead. */
export class SessionClosedError extends Error {
	constructor(sessionFile: string | undefined) {
		super(`Session manager is closed: ${sessionFile ?? "(in memory)"}`);
		this.name = "SessionClosedError";
	}
}

/** Another process took this session file; writing to it now would interleave with theirs. */
export class SessionLockLostError extends Error {
	constructor(sessionFile: string | undefined) {
		super(`Lost the lock on the session file to another KnightCode process: ${sessionFile ?? ""}`);
		this.name = "SessionLockLostError";
	}
}
```

`loadEntriesFromFile`: delete `if (pending) appendFileSync(resolvedFilePath, "\n");` and the comment above it, and change the doc comment to:

```ts
/**
 * Read a session file's entries. Never writes: readers include processes that do not own the file
 * (thread/read, forkFrom's source). The owner repairs a missing final newline after locking.
 */
```

Add a module helper below it:

```ts
/** A crash mid-append leaves the last line without its newline; the next append would glue onto it. */
function repairFinalNewline(filePath: string): void {
	const size = statSync(filePath).size;
	if (size === 0) return;
	const fd = openSync(filePath, "r+");
	try {
		const last = Buffer.alloc(1);
		readSync(fd, last, 0, 1, size - 1);
		if (last[0] !== 0x0a) writeSync(fd, "\n", size);
	} finally {
		closeSync(fd);
	}
}
```

Fields, after `private leafId: string | null = null;`:

```ts
	private lock: SessionLock | undefined;
	private closed = false;
```

Private helpers and the public methods, after `_rewriteFile()`:

```ts
	/** Hold the lock on `file`, dropping any lock on a previous file. Acquire first: a throw leaves the old lock held. */
	private _lock(file: string): void {
		if (!this.persist) return;
		const next = acquireSessionLock(file);
		this.lock?.release();
		this.lock = next;
	}

	private _unlock(): void {
		this.lock?.release();
		this.lock = undefined;
	}

	/** Every path that writes the file or moves the tree calls this before it changes memory or disk (§5.5). */
	private _assertWritable(): void {
		if (!this.persist) return;
		if (this.closed) throw new SessionClosedError(this.sessionFile);
		// The lock must be for the file this manager writes now, not merely some lock: a switch that moved
		// `sessionFile` without moving the lock must not write the new path unowned.
		if (this.sessionFile && (!this.lock || !this.lock.covers(this.sessionFile) || this.lock.lost)) {
			throw new SessionLockLostError(this.sessionFile);
		}
	}

	/** Release the file. Final: the manager stays readable and rejects writes. A no-op in memory. */
	close(): void {
		if (!this.persist) return;
		this.closed = true;
		this._unlock();
	}

	/** True when another process took the file; writes now throw SessionLockLostError. */
	hasLostLock(): boolean {
		return this.lock?.lost === true;
	}
```

`_setSessionFile`, replaced whole (canonical binding; acquire before rebinding; invalidate on a later failure):

```ts
	private _setSessionFile(sessionFile: string, preloadedFileEntries?: FileEntry[]): void {
		const resolved = canonicalSessionPath(resolvePath(sessionFile));
		// Acquisition failure leaves the original fields and ownership unchanged.
		this._lock(resolved);
		try {
			this.sessionFile = resolved;
			const exists = existsSync(resolved);
			const entries = exists ? (preloadedFileEntries ?? loadEntriesFromFile(resolved)) : [];

			if (entries.length === 0) {
				if (exists && statSync(resolved).size > 0) {
					throw new Error(`Session file is not a valid ${APP_NAME} session: ${resolved}`);
				}
				// Initialize this explicit destination without newSession(), which would release its lock.
				// Keep ownership continuously through header publication.
				this._loadEntries([{
					type: "session", version: CURRENT_SESSION_VERSION, id: createSessionId(),
					timestamp: new Date().toISOString(), cwd: this.cwd,
				}]);
				this.flushed = false;
				if (exists) {
					this._rewriteFile();
					this.flushed = true;
				}
				return;
			}

			this._loadEntries(entries);
			repairFinalNewline(resolved);
			this.flushed = true;
		} catch (error) {
			// Partially rebound state must never remain writable without ownership.
			this.close();
			throw error;
		}
	}
```

Add failed-switch regressions to `session-manager-lock.test.ts`: bind a valid manager, attempt an invalid nonempty target, catch the error, then exercise append/tree-move/flush paths. Every call throws `SessionClosedError`; both files stay unchanged and neither lock remains held. Inject empty-file initialization and migration/rewrite failures too. A target locked by a real child instead fails before rebinding: the original manager retains ownership and can append to its original file. A selected persisted path without a lock fails closed even without a compromise flag. Gate initialization of an empty explicit target and prove ownership is continuous through header publication: `_setSessionFile` must never call `newSession()` and temporarily release that target's lock.

The guard goes first in each of these, before any argument check that could be reordered later:

- `setSessionFile` (public): first line `this._assertWritable();`.
- `newSession`: first line `this._assertWritable();`. Stage/validate the next id, header and canonical destination before mutating fields; acquire its lock, commit staged fields, then release the old lock. An unflushed new manager still owns its selected destination. Acquisition failure changes neither memory nor the old lock. Initial construction without a selected path is the only persisted-manager state allowed no lock.
- `_rewriteFile`: after `if (!this.persist || !this.sessionFile) return;`, add `this._assertWritable();`.
- `_persist`: inside `if (!this.flushed) {`, after the `_hasConversation()` early return and before `openSync(this.sessionFile, "wx")`, add `this._assertWritable();`. The lock was taken when the destination was selected (rule 1); `_appendEntry` already checked, and this keeps the flush itself honest for any future caller.
- `_appendEntry`: first line `this._assertWritable();` (before `fileEntries.push`, so a rejected write leaves memory as it was).
- `branch` and `resetLeaf`: first line `this._assertWritable();`.
- `branchWithSummary`: first line `this._assertWritable();`. Today it sets `this.leafId = branchFromId` before `_appendEntry`, so without this a rejected append would still have moved the leaf.
- `createBranchedSession(leafId: string, options?: { id?: string })`: first line `this._assertWritable();`. The optional `id` mirrors `newSession` and `forkFrom`, which already take one: `if (options?.id !== undefined) assertValidSessionId(options.id); const newSessionId = options?.id ?? createSessionId();`. Compute the destination as `const newSessionFile = canonicalSessionPath(join(this.getSessionDir(), `${fileTimestamp}_${newSessionId}.jsonl`));`.

  Replace the whole persisted branch (`if (this.persist) { ... return newSessionFile; }`) with one fixed order: canonical path, new lock, memory, rewrite, then release the old lock. `_lock` is not used here, because it drops the old lock before memory moves. A refused lock changes nothing; a failure after memory moved restores it under the old lock. Locking the new path but rewriting before the fields move would write the old file under the new lock; this order cannot.

```ts
		if (this.persist) {
			// Build label entries (today's construction, unchanged: pure computation, no fields touched).
			const lastEntryId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
			let parentId = lastEntryId;
			const labelEntries: LabelEntry[] = [];
			for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
				const labelEntry: LabelEntry = {
					type: "label",
					id: generateId(new Set(pathEntryIds)),
					parentId,
					timestamp: labelTimestamp,
					targetId,
					label,
				};
				pathEntryIds.add(labelEntry.id);
				labelEntries.push(labelEntry);
				parentId = labelEntry.id;
			}

			// 1. Own the new file. A throw here leaves every field and the old lock as they were.
			const next = acquireSessionLock(newSessionFile);
			const previous = {
				fileEntries: this.fileEntries,
				sessionId: this.sessionId,
				sessionFile: this.sessionFile,
				leafId: this.leafId,
				flushed: this.flushed,
				lock: this.lock,
			};
			try {
				// 2. Memory, with the lock moved in the same step, so _assertWritable sees a lock for this file.
				this.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
				this.sessionId = newSessionId;
				this.sessionFile = newSessionFile;
				this.lock = next;
				this._buildIndex();
				// 3. Rewrite: _rewriteFile writes this.sessionFile, now the new path, under the new lock. Same rule
				// as _persist(): write now if the branched path has a conversation, otherwise at the first flush.
				this.flushed = false;
				if (this._hasConversation()) {
					this._rewriteFile();
					this.flushed = true;
				}
			} catch (error) {
				// Roll back to the old file under the old lock; drop this operation's partial file and lock. The
				// name embeds a fresh session id and this operation holds its lock, so the file can only be ours.
				this.fileEntries = previous.fileEntries;
				this.sessionId = previous.sessionId;
				this.sessionFile = previous.sessionFile;
				this._buildIndex();
				this.leafId = previous.leafId;
				this.flushed = previous.flushed;
				this.lock = previous.lock;
				rmSync(newSessionFile, { force: true });
				next.release();
				throw error;
			}
			// 4. Only now let the old file go.
			previous.lock?.release();
			return newSessionFile;
		}
```

Add to `session-manager-lock.test.ts` (it catches the old order, which moved memory before locking):

```ts
	test("a branch whose destination another holder locks changes nothing", () => {
		const { manager, file, dir } = sessionWithConversation();
		const leafBefore = manager.getLeafId();
		vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const destination = join(dir, `${stamp}_branch-dest.jsonl`);
		mkdirSync(`${destination}.lock`);
		expect(() => manager.createBranchedSession(manager.getLeafId()!, { id: "branch-dest" })).toThrow(SessionLockedError);
		expect(manager.getSessionFile()).toBe(canonicalSessionPath(file));
		expect(manager.getLeafId()).toBe(leafBefore);
		expect(existsSync(destination)).toBe(false);
		manager.appendMessage(user("still here"));
		expect(readFileSync(file, "utf8")).toContain("still here");
		expect(isLocked(file)).toBe(true);
		manager.close();
	});
```

The rollback after a failed rewrite is not reachable without injecting an I/O failure; the code above handles it, and `covers()` makes any state where the fields and the lock disagree fail closed at the next write.

Known limit, stated: rule 1 locks a destination before its file exists, so a process killed before its first flush leaves `<name>.jsonl.lock/` and `<name>.jsonl.lock-owner` beside a file that never existed. Listing and lookup read only `.jsonl` files, so the residue is inert; nothing reuses the name (it embeds a fresh UUIDv7). No cleanup in Phase A.

`forkFrom` gains a leaf: `options?: NewSessionOptions & { leafId?: string }`. With `leafId` it writes only the path to that entry (with its labels, as `createBranchedSession` keeps them), so a fork at an item is one file, never a full copy trimmed afterwards. Add this module helper below `repairFinalNewline`:

```ts
/** The path to `leafId` with its labels, as createBranchedSession builds it. Throws if the id is unknown. */
function branchEntries(entries: FileEntry[], leafId: string): SessionEntry[] {
	const manager = SessionManager.inMemory(process.cwd(), undefined, entries);
	manager.createBranchedSession(leafId);
	return manager.getEntries();
}
```

An in-memory manager takes no lock and writes nothing (`createBranchedSession`'s in-memory branch replaces its entries in memory). Then replace everything from the `// Write new header pointing to source as parent, with updated cwd` comment to the end of the method with:

```ts
		// Write new header pointing to source as parent, with updated cwd
		const newHeader: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: newSessionId,
			timestamp,
			cwd: resolvedTargetCwd,
			parentSession: resolvedSourcePath,
		};
		const copied =
			options?.leafId === undefined
				? sourceEntries.filter((entry) => entry.type !== "session")
				: branchEntries(sourceEntries, options.leafId);
		const content = [newHeader, ...copied].map((entry) => `${JSON.stringify(entry)}\n`).join("");

		// Locked before the file exists, and written in one step, so nothing finds it unlocked or half
		// written (§5.5). The manager's own acquisition counts onto this one; releasing ours keeps it held.
		const lock = acquireSessionLock(newSessionFile);
		let created = false;
		try {
			const fd = openSync(newSessionFile, "wx");
			created = true;
			try {
				writeFileSync(fd, content);
			} finally {
				closeSync(fd);
			}
			return new SessionManager(resolvedTargetCwd, dir, newSessionFile, true);
		} catch (error) {
			if (created) rmSync(newSessionFile, { force: true });
			throw error;
		} finally {
			lock.release();
		}
```

`open()`'s fallback for an oversized header (`:1771`) still calls `loadEntriesFromFile`; it no longer writes, and the constructor repairs after locking.

- [ ] **Step 9: Close the manager when a session is disposed**

In `agent-session.ts` `dispose()`, after `cleanupSessionResources(this.sessionId);`:

```ts
		// The manager's lock must not outlive the session. Covers the runtime's session switches,
		// app server unloads and SDK callers alike (app server §5.5).
		this.sessionManager.close();
```

The runtime's in-memory fork path (`agent-session-runtime.ts:350`) reuses the manager after `teardownCurrent` disposes the session; `close()` is a no-op for an in-memory manager, so that path is unaffected. The persisted fork path (`:332`) opens a second manager that moves to the branched file before the old session is disposed, so disposing releases only the old file's count.

- [ ] **Step 10: Add the runtime test**

In `packages/cli/test/suite/agent-session-runtime.test.ts`, add to the existing `describe`. `createRuntimeForTest` (`:40-125`) already builds a persisted runtime under a temp session dir, queues three faux replies (`"one"`, `"two"`, `"three"`) and disposes the runtime in cleanup:

```ts
	it("replacing the session releases the old session file lock", async () => {
		const { runtime } = await createRuntimeForTest(() => {});
		await runtime.session.prompt("hello");
		const oldFile = runtime.session.sessionFile!;
		expect(lockfile.checkSync(oldFile, { realpath: false })).toBe(true);
		await runtime.newSession();
		expect(lockfile.checkSync(oldFile, { realpath: false })).toBe(false);
	});
```

Add `import lockfile from "proper-lockfile";` to the file's imports.

- [ ] **Step 11: Run the tests, then the suites that open session files**

Run: `cd packages/cli && bun x vitest --run test/session-lock.test.ts test/session-lock-process.test.ts test/session-manager-lock.test.ts test/suite/agent-session-runtime.test.ts`
Expected: PASS.

Run: `cd packages/cli && bun x vitest --run test/session-manager test/suite`
Expected: PASS. A `SessionLockedError` means a path opens one file from two processes' worth of managers without closing; a `SessionClosedError` means a path writes through a manager after its session was disposed. Fix that path; never loosen the contract. On Windows, re-run a failure in isolation before treating it as a regression (AGENTS.md).

- [ ] **Step 12: Type check and commit**

Run: `bun run check-types`

```bash
git add packages/cli/src/core/session-lock.ts packages/cli/src/core/session-manager.ts packages/cli/src/core/agent-session.ts packages/cli/test/session-lock.test.ts packages/cli/test/session-lock-process.test.ts packages/cli/test/session-manager-lock.test.ts packages/cli/test/fixtures/take-session-lock.ts packages/cli/test/fixtures/stall-session-lock.ts packages/cli/test/suite/agent-session-runtime.test.ts
git commit -m "feat(cli): lock live session files and reject writes without the lock"
```

---

### Task 3: The terminal offers a fork on a held lock

**Files:**
- Modify: `packages/cli/src/main.ts` (`openSessionOrExit` `:347-355`, `createSessionManager` `:367-458`, the reopen at `:815`), `packages/cli/src/modes/interactive/interactive-mode.ts` (`handleResumeSession` `:5762-5795`)
- Create: `packages/cli/test/main-session-lock.test.ts`
- Create: `.changeset/<branch>.md` (via `bun run changeset`)

**Interfaces:**
- Consumes: `SessionLockedError`, `SessionManager.forkFrom`, `SessionManager.close()` (Task 2).
- Produces: `openOrOfferFork(open, cwd, sessionDir, confirm)` exported from `main.ts` for the test.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/main-session-lock.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { canonicalSessionPath } from "../src/core/session-lock.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { openOrOfferFork } from "../src/main.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function lockedSession() {
	const dir = mkdtempSync(join(tmpdir(), "knightcode-main-lock-"));
	dirs.push(dir);
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 });
	const file = manager.getSessionFile()!;
	manager.close();
	// Another process's fresh lock directory (as in session-lock.test.ts).
	mkdirSync(`${file}.lock`);
	return { dir, file, release: () => rmSync(`${file}.lock`, { recursive: true, force: true }) };
}

test("a held session opens as a fork when the user accepts", async () => {
	const { dir, file, release } = lockedSession();
	try {
		const opened = await openOrOfferFork(() => SessionManager.open(file), dir, dir, async () => true);
		expect(opened.getSessionFile()).not.toBe(canonicalSessionPath(file));
		// The fork names its source by the canonical path the lock error carried.
		expect(opened.getHeader()?.parentSession).toBe(canonicalSessionPath(file));
		opened.close();
	} finally {
		release();
	}
});

test("a held session is refused when the user declines", async () => {
	const { dir, file, release } = lockedSession();
	try {
		await expect(openOrOfferFork(() => SessionManager.open(file), dir, dir, async () => false)).rejects.toThrow(
			"open in another KnightCode process",
		);
	} finally {
		release();
	}
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/main-session-lock.test.ts`
Expected: FAIL, `openOrOfferFork` is not exported.

- [ ] **Step 3: Implement in `main.ts`**

Import `SessionLockedError` from `./core/session-lock.ts`. Add above `createSessionManager`:

```ts
/**
 * Open a session; when another KnightCode process holds it (the desktop app,
 * another terminal), offer to continue in a fork instead. Forking reads the
 * source file and needs no lock on it. Declining rethrows.
 */
export async function openOrOfferFork(
	open: () => SessionManager,
	cwd: string,
	sessionDir: string | undefined,
	confirm: (message: string) => Promise<boolean>,
): Promise<SessionManager> {
	try {
		return open();
	} catch (error) {
		if (!(error instanceof SessionLockedError)) throw error;
		console.error(chalk.yellow(error.message));
		if (!(await confirm("Continue in a fork of it?"))) throw error;
		return SessionManager.forkFrom(error.sessionFile, cwd, sessionDir);
	}
}

/** Interactive terminals are asked; anything else declines, so scripts fail instead of hanging on a prompt. */
const confirmFork = (message: string): Promise<boolean> =>
	process.stdin.isTTY && process.stdout.isTTY ? promptConfirm(message) : Promise.resolve(false);
```

Make `openSessionOrExit` async and route through it, so the generic error branch still exits 1 with the message on decline:

```ts
async function openSessionOrExit(path: string, cwd: string, sessionDir?: string): Promise<SessionManager> {
	try {
		return await openOrOfferFork(() => SessionManager.open(path, sessionDir), cwd, sessionDir, confirmFork);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(chalk.red(`Error: ${message}`));
		process.exit(1);
	}
}
```

In `createSessionManager`, replace each direct open:

- `return openSessionOrExit(resolved.path, sessionDir);` → `return openSessionOrExit(resolved.path, cwd, sessionDir);`
- `return SessionManager.open(selectedPath, sessionDir);` (resume) → `return openSessionOrExit(selectedPath, cwd, sessionDir);`
- `return SessionManager.continueRecent(cwd, sessionDir);` → `return openOrOfferFork(() => SessionManager.continueRecent(cwd, sessionDir), cwd, sessionDir, confirmFork).catch(exitWithError);`
- `return SessionManager.open(existingSession.path, sessionDir);` → `return openSessionOrExit(existingSession.path, cwd, sessionDir);`

with, beside `confirmFork`:

```ts
function exitWithError(error: unknown): never {
	console.error(chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
	process.exit(1);
}
```

At `:815`, the reopen after a missing cwd prompt runs in the same process that opened the file at `:807`; the shared in-process lock covers it. Close the first manager there so its reference is not leaked:

```ts
			sessionManager.close();
			sessionManager = SessionManager.open(missingSessionCwdIssue.sessionFile!, sessionDir, selectedCwd);
```

- [ ] **Step 4: Handle `/resume` inside the TUI**

In `interactive-mode.ts`, import `SessionLockedError` from `../../core/session-lock.ts`. In `handleResumeSession`'s `catch`, before the `MissingSessionCwdError` branch:

```ts
			if (error instanceof SessionLockedError) {
				const fork = await this.showExtensionConfirm(
					"Session is open elsewhere",
					"It is open in another KnightCode process. Continue in a fork of it?",
				);
				if (!fork) {
					this.showStatus("Resume cancelled");
					return { cancelled: true };
				}
				const forked = SessionManager.forkFrom(error.sessionFile, this.runtimeHost.cwd, this.sessionManager.getSessionDir());
				const forkPath = forked.getSessionFile()!;
				forked.close();
				return this.handleResumeSession(forkPath, options);
			}
```

`switchSession` opens the target before tearing down the current session (`agent-session-runtime.ts:210-212`), so a held target leaves the current session running. Import `SessionManager` if the file does not already.

- [ ] **Step 5: Run the tests and the type check**

Run: `cd packages/cli && bun x vitest --run test/main-session-lock.test.ts`
Expected: PASS.

Run: `bun run check-types`

- [ ] **Step 6: Add the changeset and commit**

Run: `bun run changeset added` and complete the summary:

> Added a lock on live session files: resuming a session another KnightCode process has open now offers to continue in a fork instead of writing to the same file.

Run: `bun run scripts/changelog-sections.ts`. Expected: passes.

```bash
git add packages/cli/src/main.ts packages/cli/src/modes/interactive/interactive-mode.ts packages/cli/test/main-session-lock.test.ts .changeset/<the file bun run changeset created>.md
git commit -m "feat(cli): offer a fork when resuming a session open elsewhere"
```

---

### Task 4: Virtual-model routes owned by the session that registered them

**Files:**
- Modify: `packages/cli/src/core/model-runtime.ts` (`RegisteredVirtualModel`, `streamSimple` `:705-720` and any other method that calls `resolveModel`, `registerVirtualModel` `:941-960`, `unregisterVirtualModel` `:962-968`, `resolveModel` `:980-1011`), `packages/cli/src/core/model-registry.ts` (constructor `:52`, `streamSimple` `:132` and the other routing methods), `packages/cli/src/core/agent-session-services.ts` (`:182-193`), `packages/cli/src/core/agent-session.ts` (provider actions `:3550-3557`, the two `resolveModel` calls `:620` and `:858`, the `new ModelRegistry(...)` at `:3713`, `dispose`)
- Create: `packages/cli/test/model-runtime-virtual-owner.test.ts`

**Interfaces:**
- Produces: `type VirtualModelOwner = object`; `ModelRuntime.registerVirtualModel(definition, owner?: VirtualModelOwner)`, `.unregisterVirtualModel(provider, id, owner?)`, `.releaseVirtualModels(owner): void`; `resolveModel`'s options gain `owner?: VirtualModelOwner`; `ModelRuntime.streamSimple(model, context, options?, owner?)` (and every other method that routes a virtual model); `new ModelRegistry(runtime, owner?)`, which passes its owner to every routing call. Callers that pass no owner keep today's behaviour.

The problem (§5.2): the loader binds each virtual model's router to the registering session (`loader.ts:510`: `model.route(request, runtime.createContext())`), and `registerVirtualModel` replaces an existing registration with the same provider and id (`model-runtime.ts:949`). In one process with two threads, the second thread to load an extension takes over the first thread's router, and unloading the second leaves the first routing through a disposed session.

Two paths route a virtual model: the agent loop (`AgentSession`'s two `resolveModel` calls) and direct requests outside it. An extension calling `ctx.modelRegistry.streamSimple(...)` goes `ModelRegistry.streamSimple` → `ModelRuntime.streamSimple` → `resolveModel` with no owner (`model-runtime.ts:711`). Both paths must carry the owner, or a session's own virtual model fails with "not registered in this session" when an extension streams it directly. The session's registry facade (`new ModelRegistry(...)` at `agent-session.ts:3713`, handed to its extension runner) is per session, so it carries the owner.

The owner is the registering session's `ExtensionRuntime`: the object whose `createContext` the router calls. It exists from the moment extensions load, which matters because `createAgentSessionServices` flushes registrations queued during loading (`agent-session-services.ts:182-193`) before any `AgentSession` exists.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/model-runtime-virtual-owner.test.ts`:

```ts
import { fauxAssistantMessage, fauxProvider, InMemoryModelsStore } from "@knightcode/ai";
import { expect, test } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import type { VirtualModelDefinition } from "../src/core/virtual-models.ts";

/** The setup test/virtual-models.test.ts uses: an in-memory runtime with a faux provider, refreshed. */
async function runtimeWithTarget() {
	const models = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsStore: new InMemoryModelsStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	const faux = fauxProvider({ provider: "faux-owner" });
	models.registerNativeProvider(faux.provider);
	await models.refresh({ allowNetwork: false });
	// The route must return a catalog model (ModelRoute.model is Model<Api>), as virtual-models.test.ts does.
	const target = models.getModel(faux.provider.id, faux.getModel().id)!;
	return { models, target, faux };
}

test("each owner resolves a shared virtual model through its own route", async () => {
	const { models, target } = await runtimeWithTarget();
	const seen: string[] = [];
	const ownerA = {};
	const ownerB = {};
	const definition = (label: string): VirtualModelDefinition => ({
		provider: "virt",
		id: "auto",
		name: "Auto",
		route: () => {
			seen.push(label);
			return { model: target, thinkingLevel: "off" };
		},
	});
	models.registerVirtualModel(definition("A"), ownerA);
	models.registerVirtualModel(definition("B"), ownerB);
	await models.refresh({ allowNetwork: false });
	const virtual = models.getModel("virt", "auto")!;
	const options = { reason: "direct" as const, thinkingLevel: "off" as const };
	await models.resolveModel(virtual, [], { ...options, owner: ownerA });
	await models.resolveModel(virtual, [], { ...options, owner: ownerB });
	expect(seen).toEqual(["A", "B"]);

	models.releaseVirtualModels(ownerB);
	expect(models.getModel("virt", "auto")).toBeDefined();
	await models.resolveModel(virtual, [], { ...options, owner: ownerA });
	expect(seen).toEqual(["A", "B", "A"]);
	await expect(models.resolveModel(virtual, [], { ...options, owner: ownerB })).rejects.toThrow(
		"not registered in this session",
	);

	models.releaseVirtualModels(ownerA);
	expect(models.getModel("virt", "auto")).toBeUndefined();
});

test("a registry bound to an owner streams a virtual model through that owner's route", async () => {
	const { models, target, faux } = await runtimeWithTarget();
	const seen: string[] = [];
	const ownerA = {};
	const ownerB = {};
	for (const [owner, label] of [
		[ownerA, "A"],
		[ownerB, "B"],
	] as const) {
		models.registerVirtualModel(
			{
				provider: "virt",
				id: "auto",
				name: "Auto",
				route: () => {
					seen.push(label);
					return { model: target, thinkingLevel: "off" };
				},
			},
			owner,
		);
	}
	await models.refresh({ allowNetwork: false });
	faux.setResponses([fauxAssistantMessage("direct")]);
	const registry = new ModelRegistry(models, ownerA);
	await registry.streamSimple(models.getModel("virt", "auto")!, { messages: [] }).result();
	expect(seen).toEqual(["A"]);
});

test("an unowned route serves every owner", async () => {
	const { models, target } = await runtimeWithTarget();
	models.registerVirtualModel({
		provider: "virt",
		id: "shared",
		name: "Shared",
		route: () => ({ model: target, thinkingLevel: "off" }),
	});
	await models.refresh({ allowNetwork: false });
	const virtual = models.getModel("virt", "shared")!;
	const route = await models.resolveModel(virtual, [], { reason: "direct", thinkingLevel: "off", owner: {} });
	expect(route.model.id).toBe(target.id);
});
```

The types are the real ones (`core/virtual-models.ts`): `VirtualModelDefinition` requires `provider`, `id`, `name`, `route`; `route` returns `ModelRoute` (`{ model: Model<Api>; thinkingLevel; state? }`), and `resolveModel` rejects a route whose model is not a physical catalog model with credentials, hence the refresh after registering the faux provider. `ModelRouteReason` is `"user" | "continuation" | "retry" | "direct"`; these tests route outside the agent loop, so `"direct"`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/model-runtime-virtual-owner.test.ts`
Expected: FAIL: B's registration replaced A's, so `seen` is `["B", "B"]`, or `releaseVirtualModels` is not a function.

- [ ] **Step 3: Own the routes in `ModelRuntime`**

In `model-runtime.ts`:

```ts
/**
 * Who registered a virtual model's route: the registering session's ExtensionRuntime, whose
 * createContext the router calls. Two sessions in one process (the app server) each keep their own
 * route for one shared catalog entry (app server §5.2).
 */
export type VirtualModelOwner = object;

/** Routes registered without an owner (SDK callers using the runtime directly) serve every session. */
const UNOWNED: VirtualModelOwner = Object.freeze({});
```

`RegisteredVirtualModel` becomes `{ model: Model<Api>; routes: Map<VirtualModelOwner, (request: ModelRouteRequest) => ReturnType<VirtualModelDefinition["route"]>> }` (use the request and result types the current `route` field already has).

`registerVirtualModel(definition, owner = UNOWNED)`: keep the validation; replace the `models.set` line with:

```ts
		const routes = models.get(id)?.routes ?? new Map();
		// One route per owner; re-registering by the same owner replaces only its own route.
		routes.set(owner, (request) => definition.route(request));
		models.set(id, { model: createVirtualModel(definition), routes });
```

`unregisterVirtualModel(providerId, id, owner = UNOWNED)`:

```ts
	unregisterVirtualModel(providerId: string, id: string, owner: VirtualModelOwner = UNOWNED): void {
		const models = this.virtualModels.get(providerId);
		const entry = models?.get(id);
		if (!models || !entry?.routes.delete(owner)) return;
		// The catalog entry stays while another session still routes it.
		if (entry.routes.size > 0) return;
		models.delete(id);
		if (models.size === 0) this.virtualModels.delete(providerId);
		this.recomposeProvider(providerId);
		this.updateModelSnapshot();
		// keep whatever the current method does after this point (refresh call)
	}

	/** Drop every route `owner` registered. AgentSession.dispose() calls this. */
	releaseVirtualModels(owner: VirtualModelOwner): void {
		for (const [providerId, models] of [...this.virtualModels]) {
			for (const [id, entry] of [...models]) {
				if (entry.routes.has(owner)) this.unregisterVirtualModel(providerId, id, owner);
			}
		}
	}
```

Read the current `unregisterVirtualModel` body to the end and keep its trailing refresh call.

`resolveModel`: options gain `owner?: VirtualModelOwner`. Replace the route lookup:

```ts
		const virtual = this.virtualModels.get(model.provider)?.get(model.id);
		if (!virtual) throw new Error(`${name} is not registered.`);
		const route = virtual.routes.get(options.owner ?? UNOWNED) ?? virtual.routes.get(UNOWNED);
		if (!route) throw new Error(`${name} is not registered in this session.`);
		const { failed, owner: _owner, ...request } = options;
```

and call `route({...})` where the method called `virtual.route({...})`.

Direct routing: `streamSimple` (`:705`) is the only `ModelRuntime` method that calls `resolveModel` (`:711`); `completeSimple` (`:733`) delegates to it. Both gain a fourth parameter `owner?: VirtualModelOwner`; `streamSimple` passes it in its `resolveModel` options and to its recursive call, `completeSimple` passes it on. A trailing optional parameter keeps `ModelRuntime` assignable to the `Models` interface it implements.

`model-registry.ts`:

```ts
	private readonly owner: VirtualModelOwner | undefined;

	/** `owner`: the session whose virtual-model routes this registry's direct requests use (app server §5.2). */
	constructor(runtime: ModelRuntime, owner?: VirtualModelOwner) {
		this.runtime = runtime;
		this.owner = owner;
	}
```

and the three methods that reach virtual-model routes pass it: `streamSimple` (`:132`, `return this.runtime.streamSimple(model, context, options, this.owner);`), `registerVirtualModel` (`:232`) and `unregisterVirtualModel` (`:236`). `stream` and `complete` take physical models only. Keep the constructor's other assignments.

- [ ] **Step 4: Pass the owner from services and the session**

`agent-session-services.ts:184`: `modelRuntime.registerVirtualModel(definition, extensionsResult.runtime);`

The flush registers routes before any `AgentSession` exists, and two awaits follow it (`modelRuntime.refresh`, then `applyExtensionFlagValues`). If either throws, no session will ever dispose those routes, so wrap everything after the flush:

```ts
	try {
		await modelRuntime.refresh({ allowNetwork: false });
		diagnostics.push(...applyExtensionFlagValues(resourceLoader, options.extensionFlagValues));
	} catch (error) {
		// No session will own these routes; release them before failing (app server §5.2).
		modelRuntime.releaseVirtualModels(extensionsResult.runtime);
		throw error;
	}
```

Task 5 adds its lease release to the same catch. A caller whose construction fails after `createAgentSessionServices` returned, but before an `AgentSession` exists, releases the routes itself (`ThreadManager.build`, Task 9).

`agent-session.ts`:

- Add a getter near the other private getters:

  ```ts
  	/** Owner of this session's virtual-model routes: its extension runtime (app server §5.2). */
  	private get _virtualModelOwner(): object {
  		return this._resourceLoader.getExtensions().runtime;
  	}
  ```

  Use whatever field holds the resource loader (`rg -n "getExtensions\(\)" packages/cli/src/core/agent-session.ts`). The owner must be the same object `agent-session-services.ts` passed, so the services flush and later registrations share one route.

- The runner's registry (`:3713`): `new ModelRegistry(this._modelRuntime, extensionsResult.runtime)`, so `ctx.modelRegistry` streams the session's own virtual models.
- Provider actions (`:3550-3557`): `this._modelRuntime.registerVirtualModel(definition, this._virtualModelOwner);` and `this._modelRuntime.unregisterVirtualModel(provider, id, this._virtualModelOwner);`.
- Both `resolveModel` calls (`:620`, `:858`): add `owner: this._virtualModelOwner` to the options object.
- `dispose()`: before the `sessionManager.close()` Task 2 added, `this._modelRuntime.releaseVirtualModels(this._virtualModelOwner);`.
- `/reload` rebuilds extensions. Read `reload()` in `agent-session.ts`: if it replaces the resource loader's extension runtime with a new object, capture the old owner before the reload and call `releaseVirtualModels(oldOwner)` after the new extensions bind, so the old routes do not linger.

- [ ] **Step 5: Run the tests**

Run: `cd packages/cli && bun x vitest --run test/model-runtime-virtual-owner.test.ts`
Expected: PASS.

Run: `cd packages/cli && rg -ln "registerVirtualModel|virtual model" test | xargs bun x vitest --run`
Expected: PASS: the terminal's single-session behaviour is unchanged. (On Windows without `xargs`, list the files from `rg -ln` and pass them to one `bun x vitest --run` call.)

- [ ] **Step 6: Type check and commit**

Run: `bun run check-types`

```bash
git add packages/cli/src/core/model-runtime.ts packages/cli/src/core/model-registry.ts packages/cli/src/core/agent-session-services.ts packages/cli/src/core/agent-session.ts packages/cli/test/model-runtime-virtual-owner.test.ts
git commit -m "feat(cli): own virtual model routes per session in the shared model runtime"
```

Task 11 adds the end-to-end checks: two app server threads selecting one extension's virtual model each route with their own session's context, through an agent turn and through an extension command that calls `ctx.modelRegistry.streamSimple`.

---

### Task 5: Bounded, leased extension cache per cwd, the `desktop` mode, and turn markers

**Files:**
- Create: `packages/cli/src/extensions/turn-marker.ts`, `packages/cli/test/extension-cache-cwd.test.ts`, `packages/cli/test/suite/turn-marker.test.ts`
- Modify: `packages/cli/src/core/extensions/loader.ts:118-140,555-594,690`, `packages/cli/src/core/resource-loader.ts` (lease lifetime), `packages/cli/src/core/agent-session.ts` (release leases on dispose), `packages/cli/src/core/agent-session-services.ts` (release on construction failure), `packages/cli/src/core/extensions/types.ts:324`, `packages/cli/src/extensions/index.ts`, `packages/cli/src/extensions/{plan-mode,mcp,ui,llama,undo,usage}/index.ts` (only where Step 4 finds a wrong branch), `packages/cli/docs/extensions.md` (State section)

**Interfaces:**
- Produces: `ExtensionMode` includes `"desktop"`. From `extensions/turn-marker.ts`: `TURN_MARKER_TYPE = "knightcode.turn"`, `TURN_END_TYPE = "knightcode.turnEnd"`, `interface TurnEnd { status: "completed" | "interrupted" | "failed"; error?: string }`, `isTurnMarker(entry)`, `isTurnEnd(entry)`, `turnEndOf(aborted: boolean, branch: readonly SessionEntry[]): TurnEnd`, `openMarkerOf(branch): SessionEntry | undefined`, `turnEndAt(branch): TurnEnd | undefined`, `turnMarkerExtension: InlineExtension`.

Turn boundaries (§4.2): a turn is one agent run. `agent_start` fires again inside a run (an automatic retry at `agent-session.ts:3826-3865`, a follow-up, overflow recovery), while `agent_settled` fires once at its end (`:1112-1122`). So the marker is written at the run's first `agent_start` only, and an end entry carries the outcome. The app server's mapper (Task 11) and reader (Task 10) use the helpers here, so live and read-back agree by construction.

- [ ] **Step 1: Write the failing cache test**

`packages/cli/test/extension-cache-cwd.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { ExtensionRuntime } from "../src/core/extensions/types.ts";
import { loadExtensionsCached, releaseExtensionCache } from "../src/core/extensions/loader.ts";

const dirs: string[] = [];
const leased: ExtensionRuntime[] = [];
afterEach(() => {
	// Bare loadExtensionsCached callers own their result runtime's leases (Step 3).
	for (const runtime of leased.splice(0)) releaseExtensionCache(runtime);
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("loading extensions for a second cwd does not evict the first cwd's modules", async () => {
	const a = mkdtempSync(join(tmpdir(), "knightcode-cache-a-"));
	const b = mkdtempSync(join(tmpdir(), "knightcode-cache-b-"));
	dirs.push(a, b);
	const extension = join(a, "counter.ts");
	// Module state counts evaluations; a cache hit does not re-evaluate.
	writeFileSync(
		extension,
		"globalThis.__kcEvaluations = (globalThis.__kcEvaluations ?? 0) + 1;\nexport default function () {}\n",
	);
	const evaluations = () => (globalThis as { __kcEvaluations?: number }).__kcEvaluations ?? 0;
	const before = evaluations();
	for (const cwd of [a, b, a]) leased.push((await loadExtensionsCached([extension], cwd)).runtime);
	expect(evaluations() - before).toBe(2);
});
```

`loadExtensionsCached(paths, cwd, eventBus?, runtime?)` (`loader.ts:731`) is the exported entry that calls `loadExtensionsInternal` with the cache on. The assertion is what matters: a, b, a evaluates twice (a once, b once).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/extension-cache-cwd.test.ts`
Expected: FAIL, 3 evaluations (b clears a's entry).

- [ ] **Step 3: Key the cache by `(cwd, path)`**

In `loader.ts`, replace the cache state and helpers (`:118-140`):

```ts
let extensionCacheGeneration = 0;
/** Keyed by resolved cwd, then extension path: threads in two projects must not evict each other. */
const extensionCache = new Map<string, ExtensionFactory>();

interface ExtensionCacheToken {
	cwd: string;
	generation: number;
}

export function clearExtensionCache(): void {
	extensionCache.clear();
	extensionCacheGeneration++;
}

function useExtensionCacheCwd(cwd: string): ExtensionCacheToken {
	return { cwd: resolvePath(cwd), generation: extensionCacheGeneration };
}

function cacheKey(token: ExtensionCacheToken, extensionPath: string): string {
	return `${token.cwd}\0${extensionPath}`;
}
```

`isCurrentCacheToken` (`:555`) checks the generation only:

```ts
function isCurrentCacheToken(cacheToken: ExtensionCacheToken | undefined): cacheToken is ExtensionCacheToken {
	return cacheToken !== undefined && extensionCacheGeneration === cacheToken.generation;
}
```

In `loadExtensionModule`, use `cacheKey(cacheToken, extensionPath)` for lookups/writes, then add bounded retention; the plain map above shows keying only, not the complete cache implementation.

Export `leaseExtensionCache(runtime: ExtensionRuntime, cwd: string, paths: readonly string[]): void` and `releaseExtensionCache(runtime: ExtensionRuntime): void` from `loader.ts`. Pin resolved `(cwd, path)` keys before async loading; leases are idempotent per runtime/key. Entries track factory, generation and last-use order. Keep at most `MAX_INACTIVE_EXTENSION_FACTORIES = 256` unpinned entries, evicting inactive LRU entries after insertion/release. Active/in-flight keys remain pinned even above 256. Failed import/factory initialization releases that key; failed whole-session loading releases all its leases. Generation checks prevent stale async imports repopulating `/reload`'s cache.

`DefaultResourceLoader` releases old result-runtime leases on reload/replacement and exposes `releaseExtensionCache(): void` through `ResourceLoader`; implementations not using this cache implement a no-op. `AgentSession.dispose()` calls it. Add tests for 300 distinct inactive keys leaving 256 entries, active pinning, release after unload/failure, and a gated old-generation import completing after clear. Bare `loadExtensionsCached` test callers release their result-runtime leases in cleanup. `createAgentSessionServices` releases its loader's leases if reload/service construction throws; `ThreadManager.build` retains `services.resourceLoader` and releases it if session construction fails before a LoadedThread exists. Implement actual catch-path cleanup, not only afterEach. Add gated service/session-construction failure tests. Include `agent-session-services.ts` in this task's modified-file manifest. Module unloading is not promised; measure runtime module retention separately in Task 15.

Add under the State heading of `packages/cli/docs/extensions.md`:

```markdown
Module-level variables are shared by every session in the process that loads
the extension, and so are the providers it registers: one session calling
`unregisterProvider` removes the provider for all of them. The desktop app's
app server runs many sessions in one process, so keep per-session state inside
the factory closure, not at module level. Virtual models are the exception:
each session keeps its own route. Active cached factories are pinned; up to
256 inactive factories remain. Eviction or `/reload` can re-evaluate a module
on a future load, so module globals are not persistent storage. Eviction
never tears down a live session's extension.
```

- [ ] **Step 4: Add `"desktop"` and audit mode branches**

`types.ts:324`:

```ts
export type ExtensionMode = "tui" | "rpc" | "json" | "print" | "desktop";
```

Run: `rg -n 'ctx\.mode|mode === "|mode !== "' packages/cli/src/extensions packages/tools/src packages/remote/src`

For each branch, decide what a desktop window should get: a GUI client that answers dialogs and toasts (Phase C) but cannot render TUI components. Rules:

- `ctx.mode === "tui"` guarding a TUI component (`ctx.ui.custom`, a TUI manager): leave it; desktop falls to the else branch.
- `ctx.mode === "rpc"` choosing a notice over raw stdout (plan mode `:334`): make it `ctx.mode === "rpc" || ctx.mode === "desktop"`.
- `ctx.mode === "print"` writing to stdout: leave it.
- `ctx.mode !== "tui"` returning early from a UI-only feature: leave it.

Expected edits: `plan-mode/index.ts:334`, plus any `rpc` branch the grep finds. Record each decision in the commit message body.

Plan mode in a desktop thread, by name, because `hasUI` stays false until Phase C (no UI context is bound):

- `:334`, after a plan is submitted: `ctx.mode === "rpc" || ctx.mode === "desktop"` takes the notice branch. `notice()` (`:65`) calls `ctx.ui.notify` only when `ctx.hasUI`, so in Phase A the desktop gets nothing from it; the plan itself is in the transcript as the `submit_plan` call.
- `:402`, `/plan` with no arguments: `!ctx.hasUI` is true for desktop, so it takes the same notice branch instead of the review picker, and the notice is dropped for the same reason.
- `:415`, the review picker: `ctx.mode === "tui"` keeps the TUI component; desktop falls to the dialog branch once Phase C sets `hasUI`.

So in Phase A a desktop user approves by typing `/plan approve` or `/plan approve fresh` (`:362`); the fresh variant is the `ctx.newSession({ withSession })` path Task 13 tests. That is accepted for Phase A and listed in `app-server.md` (Task 15); Phase C gives desktop `hasUI` and both branches start showing.

- [ ] **Step 5: Write the failing turn-marker test**

`packages/cli/test/suite/turn-marker.test.ts`, on the suite harness (`test/suite/harness.ts`: `createHarness({ extensionFactories, settings })`, `harness.setResponses`, `harness.cleanup`). Retry settings and the retryable error text are the ones `test/suite/agent-session-retry-events.test.ts:34-46` uses. The harness has no slow-stream option, so the abort test holds the reply in a response factory that waits for the request's abort signal, and aborts once the factory has been entered: a gate, not a sleep.

```ts
import { fauxAssistantMessage } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import { TURN_END_TYPE, TURN_MARKER_TYPE, turnMarkerExtension } from "../../src/extensions/turn-marker.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;
afterEach(() => harness?.cleanup());

const kinds = (branch: SessionEntry[]) =>
	branch.map((entry) =>
		entry.type === "custom" ? entry.customType : entry.type === "message" ? entry.message.role : entry.type,
	);
const ends = (branch: SessionEntry[]) =>
	branch.flatMap((entry) => (entry.type === "custom" && entry.customType === TURN_END_TYPE ? [entry.data] : []));

test("each prompt is one marker before its user message and one end entry", async () => {
	harness = await createHarness({ extensionFactories: [turnMarkerExtension] });
	harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
	await harness.session.prompt("first");
	await harness.session.prompt("second");
	const branch = harness.session.sessionManager.getBranch();
	expect(kinds(branch).filter((k) => k === TURN_MARKER_TYPE)).toHaveLength(2);
	expect(kinds(branch).indexOf(TURN_MARKER_TYPE)).toBeLessThan(kinds(branch).indexOf("user"));
	expect(ends(branch)).toEqual([{ status: "completed" }, { status: "completed" }]);
});

test("an automatic retry stays inside one turn", async () => {
	harness = await createHarness({
		extensionFactories: [turnMarkerExtension],
		settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
	});
	harness.setResponses([
		fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
		fauxAssistantMessage("recovered"),
	]);
	await harness.session.prompt("go");
	const branch = harness.session.sessionManager.getBranch();
	expect(kinds(branch).filter((k) => k === TURN_MARKER_TYPE)).toHaveLength(1);
	expect(ends(branch)).toEqual([{ status: "completed" }]);
});

test("a follow-up queued during a run stays inside its turn", async () => {
	harness = await createHarness({ extensionFactories: [turnMarkerExtension] });
	let entered!: () => void;
	const replying = new Promise<void>((resolve) => (entered = resolve));
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	harness.setResponses([
		async () => {
			entered();
			await released;
			return fauxAssistantMessage("one");
		},
		fauxAssistantMessage("two"),
	]);
	const running = harness.session.prompt("first");
	// The run is inside its first model request, so the follow-up queues behind it.
	await replying;
	await harness.session.followUp("then this");
	release();
	await running;
	await harness.session.waitForIdle();
	const branch = harness.session.sessionManager.getBranch();
	expect(kinds(branch).filter((k) => k === "user")).toHaveLength(2);
	expect(kinds(branch).filter((k) => k === TURN_MARKER_TYPE)).toHaveLength(1);
	expect(ends(branch)).toHaveLength(1);
});

test("an aborted run ends interrupted", async () => {
	harness = await createHarness({ extensionFactories: [turnMarkerExtension] });
	let entered!: () => void;
	const replying = new Promise<void>((resolve) => (entered = resolve));
	harness.setResponses([
		// Holds the request until it is aborted, then answers as an aborted stream does.
		(_context, options) =>
			new Promise((resolve) => {
				entered();
				options?.signal?.addEventListener("abort", () => resolve(fauxAssistantMessage("", { stopReason: "aborted" })), {
					once: true,
				});
			}),
	]);
	const running = harness.session.prompt("slow");
	await replying;
	await harness.session.abort();
	await running.catch(() => {});
	expect(ends(harness.session.sessionManager.getBranch())).toEqual([{ status: "interrupted" }]);
});
```

A response step may be a factory (`FauxResponseFactory`, `packages/ai/src/providers/faux.ts:108`: `(context, options, state, model) => AssistantMessage | Promise<AssistantMessage>`); `options.signal` is the request's abort signal. `followUp(text, images?, options?)` is at `agent-session.ts:2270`. If the follow-up is delivered without a second `agent_start` in this harness, the test still holds; it guards the case where it is.

- [ ] **Step 6: Write `turn-marker.ts` and register it**

`packages/cli/src/extensions/turn-marker.ts`:

```ts
/**
 * Turn boundaries in the session file (app server §4.2).
 *
 * The file has no notion of a turn, and agent_start is not one: a retry, a follow-up or overflow
 * recovery starts the agent again inside one run, which settles once. This built-in writes
 * `knightcode.turn` at the first agent_start of a run and `knightcode.turnEnd` with the outcome at
 * agent_settled. The marker's entry id is the turn id. The app server's live mapper and its reader
 * both use these helpers, so a live turn and the same turn read back carry the same ids and status.
 */

import type { InlineExtension } from "../core/extensions/types.ts";
import type { SessionEntry } from "../core/session-manager.ts";

export const TURN_MARKER_TYPE = "knightcode.turn";
export const TURN_END_TYPE = "knightcode.turnEnd";

export interface TurnEnd {
	status: "completed" | "interrupted" | "failed";
	error?: string;
}

export const isTurnMarker = (entry: SessionEntry): boolean =>
	entry.type === "custom" && entry.customType === TURN_MARKER_TYPE;
export const isTurnEnd = (entry: SessionEntry): boolean => entry.type === "custom" && entry.customType === TURN_END_TYPE;

/** The outcome of a settled run: an abort wins; otherwise the run's last assistant message decides. */
export function turnEndOf(aborted: boolean, branch: readonly SessionEntry[]): TurnEnd {
	if (aborted) return { status: "interrupted" };
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isTurnMarker(entry)) break;
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		if (entry.message.stopReason === "aborted") return { status: "interrupted" };
		if (entry.message.stopReason === "error") {
			return { status: "failed", error: entry.message.errorMessage ?? "the turn failed" };
		}
		return { status: "completed" };
	}
	return { status: "completed" };
}

/**
 * The marker the current run wrote, if any. Walks back from the leaf: the run's marker comes before
 * any of its messages, so reaching a message or a previous turn's end first means there is none.
 * Another extension may append after the marker, so it is not necessarily the leaf.
 */
export function openMarkerOf(branch: readonly SessionEntry[]): SessionEntry | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isTurnMarker(entry)) return entry;
		if (isTurnEnd(entry) || entry.type === "message") return undefined;
	}
	return undefined;
}

/** The end entry of the latest turn, if it has one. Malformed data reads as undefined. */
export function turnEndAt(branch: readonly SessionEntry[]): TurnEnd | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (isTurnMarker(entry)) return undefined;
		if (entry.type === "custom" && entry.customType === TURN_END_TYPE) return parseTurnEnd(entry.data);
	}
	return undefined;
}

export function parseTurnEnd(data: unknown): TurnEnd | undefined {
	if (typeof data !== "object" || data === null) return undefined;
	const { status, error } = data as { status?: unknown; error?: unknown };
	if (status !== "completed" && status !== "interrupted" && status !== "failed") return undefined;
	return typeof error === "string" ? { status, error } : { status };
}

export const turnMarkerExtension: InlineExtension = {
	name: "turn-marker",
	hidden: true,
	builtin: true,
	factory: (knightcode) => {
		// Per session: the factory runs once per session. agent_settled fires once per run, including a
		// failed one, so the flag cannot stay set across runs.
		let open = false;
		knightcode.on("agent_start", () => {
			if (open) return;
			open = true;
			knightcode.appendEntry(TURN_MARKER_TYPE);
		});
		knightcode.on("agent_settled", (event, ctx) => {
			if (!open) return;
			open = false;
			knightcode.appendEntry(TURN_END_TYPE, turnEndOf(event.aborted, ctx.sessionManager.getBranch()));
		});
	},
};
```

`AgentSettledEvent` carries `aborted` (`core/extensions/types.ts:1014`), and the handler's `ctx.sessionManager` is a `ReadonlySessionManager`, which includes `getBranch` (`session-manager.ts:242`).

In `packages/cli/src/extensions/index.ts`, import `turnMarkerExtension` and put it first in `builtInExtensions`:

```ts
	// Writes a start and an end entry around every agent run, so turns read back with the ids they had
	// live (app server §4.2). First, so its agent_start handler runs before any other built-in's.
	turnMarkerExtension,
```

- [ ] **Step 7: Run tests, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/extension-cache-cwd.test.ts test/suite/turn-marker.test.ts test/suite/plan-mode.test.ts`
Expected: PASS.

Run: `bun run check-types`

```bash
git add packages/cli/src/core/extensions/loader.ts packages/cli/src/core/resource-loader.ts packages/cli/src/core/agent-session.ts packages/cli/src/core/agent-session-services.ts packages/cli/src/core/extensions/types.ts packages/cli/src/extensions/turn-marker.ts packages/cli/src/extensions/index.ts packages/cli/src/extensions/plan-mode/index.ts packages/cli/docs/extensions.md packages/cli/test/extension-cache-cwd.test.ts packages/cli/test/suite/turn-marker.test.ts
# plus, by path, each other extension file Step 4's audit changed
git commit -m "feat(cli): per-cwd extension cache, desktop extension mode, turn markers"
```

---

### Task 6: Transports

**Files:**
- Create: `packages/cli/src/app-server/transport.ts`, `stdio.ts`, `in-process.ts`, `packages/cli/test/app-server/transport.test.ts`

**Interfaces:**
- Produces:
  - `interface Transport { send(message: Message): void; onMessage(handler: (message: unknown) => void): void; onInputEnd(handler: () => void): void; onClose(handler: () => void): void; close(mode?: "drain" | "abort"): void }`
  - `interface StdioLimits { maxLineBytes: number; maxPendingBytes: number }`, `DEFAULT_STDIO_LIMITS`
  - `createStdioTransport(input: Readable, write: (text: string) => Promise<void>, limits?: StdioLimits): Transport`
  - `createInProcessPair(capacity?: number): { client: Transport; server: Transport }`

§5.9 sets the limits. Three behaviours matter most:

- End of input is not end of output. On stdin EOF the stdio transport stops reading and fires `onInputEnd`; it keeps writing until `close()`. A probe of the previous design, which entered draining at EOF, dispatched a request, ended input, then completed the handler: the response was dropped, because a draining transport refuses new sends. `AppServer` (Task 7) decides when output ends: after every request it accepted has been answered.
- `close("drain")` delivers everything already sent, then closes; `close("abort")` drops it. Without the distinction, a `versionMismatch` response sent just before closing was cleared from the queue and never reached the client.
- Both directions are bounded, in UTF-8 bytes. An oversized stdin line is dropped up to its newline with an `error` notification; output the client is not reading aborts the connection once more than `maxPendingBytes` is waiting. JavaScript string length would undercount: `"é"` is one UTF-16 code unit and two bytes, most CJK characters one unit and three bytes. The reader works on raw bytes and splits at `0x0A`, which never occurs inside a multibyte UTF-8 character, so a split never cuts one, and it decodes each whole line once. The in-process pair closes both ends when a queue passes its capacity.

The in-process pair delivers asynchronously and in order, so a handler that sends never re-enters the peer synchronously. It has no half-close: a peer's `close()` reaches the other end after the messages queued before it, and ends both directions.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/app-server/transport.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import { createInProcessPair } from "../../src/app-server/in-process.ts";
import { createStdioTransport } from "../../src/app-server/stdio.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function stdio(limits?: { maxLineBytes: number; maxPendingBytes: number }) {
	const input = new PassThrough();
	const written: string[] = [];
	let stall: Promise<void> | undefined;
	const write = async (text: string) => {
		if (stall) await stall;
		written.push(text);
	};
	const transport = createStdioTransport(input, write, limits);
	const received: unknown[] = [];
	transport.onMessage((message) => received.push(message));
	let closed = 0;
	transport.onClose(() => closed++);
	let inputEnded = 0;
	transport.onInputEnd(() => inputEnded++);
	return {
		input,
		written,
		transport,
		received,
		closed: () => closed,
		inputEnded: () => inputEnded,
		block: () => {
			stall = new Promise(() => {});
		},
	};
}

test("stdio parses one message per line, answers bad JSON with an error notification, and stays open", async () => {
	const s = stdio();
	s.input.write('{"method":"initialized","params":{}}\n{not json\n{"id":1,"meth');
	s.input.write('od":"model/list","params":{}}\n');
	await tick();
	expect(s.received).toEqual([
		{ method: "initialized", params: {} },
		{ id: 1, method: "model/list", params: {} },
	]);
	expect(s.written).toHaveLength(1);
	expect(JSON.parse(s.written[0])).toMatchObject({ method: "error", params: { message: expect.stringContaining("JSON") } });
	s.transport.send({ id: 1, result: {} });
	await tick();
	expect(s.written[1]).toBe('{"id":1,"result":{}}\n');
});

test("stdio drops an oversized line up to its newline and keeps reading", async () => {
	// 40 fits the initialized line (36 bytes) but not the padded one.
	const s = stdio({ maxLineBytes: 40, maxPendingBytes: 1_000_000 });
	s.input.write(`{"method":"x","params":{"pad":"${"a".repeat(40)}`);
	s.input.write(`${"a".repeat(40)}"}}\n{"method":"initialized","params":{}}\n`);
	await tick();
	expect(s.received).toEqual([{ method: "initialized", params: {} }]);
	expect(s.written.map((line) => JSON.parse(line).method)).toEqual(["error"]);
	expect(s.closed()).toBe(0);
});

test("stdio counts the line limit in UTF-8 bytes, not characters", async () => {
	// 32 ASCII characters plus 20 two-byte characters: 52 characters, 72 bytes.
	const s = stdio({ maxLineBytes: 60, maxPendingBytes: 1_000_000 });
	s.input.write(Buffer.from(`{"method":"x","params":{"t":"${"é".repeat(20)}"}}\n{"method":"initialized","params":{}}\n`, "utf8"));
	await tick();
	expect(s.received).toEqual([{ method: "initialized", params: {} }]);
	expect(s.written.map((line) => JSON.parse(line).method)).toEqual(["error"]);
});

test("stdio decodes a multibyte character split across chunks", async () => {
	const s = stdio();
	const bytes = Buffer.from('{"method":"x","params":{"t":"é"}}\n', "utf8");
	const cut = bytes.indexOf(0xc3) + 1;
	s.input.write(bytes.subarray(0, cut));
	s.input.write(bytes.subarray(cut));
	await tick();
	expect(s.received).toEqual([{ method: "x", params: { t: "é" } }]);
});

test("stdio aborts a client that stops reading", async () => {
	const s = stdio({ maxLineBytes: 1_000, maxPendingBytes: 64 });
	s.block();
	for (let i = 0; i < 10; i++) s.transport.send({ method: "n", params: { i } });
	await tick();
	expect(s.closed()).toBe(1);
});

test("stdio closes once when a write fails, and drops later sends", async () => {
	const input = new PassThrough();
	let writes = 0;
	const transport = createStdioTransport(input, async () => {
		writes++;
		throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
	});
	let closed = 0;
	transport.onClose(() => closed++);
	transport.send({ method: "a", params: {} });
	await tick();
	await tick();
	expect(closed).toBe(1);
	transport.send({ method: "b", params: {} });
	await tick();
	expect(writes).toBe(1);
});

test("stdio abort drops lines that are still queued", async () => {
	const s = stdio();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	// The first write is in flight; the rest wait behind it.
	const transport = createStdioTransport(s.input, async (text) => {
		await gate;
		s.written.push(text);
	});
	transport.send({ method: "a", params: {} });
	await tick();
	transport.send({ method: "b", params: {} });
	transport.send({ method: "c", params: {} });
	transport.close("abort");
	release();
	await tick();
	await tick();
	expect(s.written.map((line) => JSON.parse(line).method)).toEqual(["a"]);
});

test("stdio EOF ends input only: the last line is read, later sends are written, and close drains", async () => {
	const s = stdio();
	s.input.end('{"method":"initialized","params":{}}');
	await tick();
	expect(s.received).toEqual([{ method: "initialized", params: {} }]);
	expect(s.inputEnded()).toBe(1);
	expect(s.closed()).toBe(0);
	// A handler that finishes after EOF still answers.
	s.transport.send({ id: 1, result: {} });
	s.transport.close("drain");
	await tick();
	await tick();
	expect(s.written).toEqual(['{"id":1,"result":{}}\n']);
	expect(s.closed()).toBe(1);
});

test("in-process delivers in order, asynchronously, both ways", async () => {
	const { client, server } = createInProcessPair();
	const atServer: unknown[] = [];
	const atClient: unknown[] = [];
	server.onMessage((m) => atServer.push(m));
	client.onMessage((m) => atClient.push(m));
	client.send({ id: 1, method: "a", params: {} });
	client.send({ id: 2, method: "b", params: {} });
	expect(atServer).toEqual([]);
	server.send({ method: "n", params: {} });
	await tick();
	expect(atServer.map((m) => (m as { id: number }).id)).toEqual([1, 2]);
	expect(atClient).toEqual([{ method: "n", params: {} }]);
});

test("in-process close drains what was sent; abort drops it", async () => {
	const drained = createInProcessPair();
	const gotDrained: unknown[] = [];
	drained.client.onMessage((m) => gotDrained.push(m));
	drained.server.send({ id: 1, error: { code: "versionMismatch", message: "x" } });
	drained.server.close();
	await tick();
	expect(gotDrained).toHaveLength(1);

	const aborted = createInProcessPair();
	const gotAborted: unknown[] = [];
	let closed = 0;
	aborted.client.onMessage((m) => gotAborted.push(m));
	aborted.client.onClose(() => closed++);
	aborted.server.send({ id: 1, result: {} });
	aborted.server.close("abort");
	await tick();
	expect(gotAborted).toEqual([]);
	expect(closed).toBe(1);
});

test("in-process overflow closes both ends", async () => {
	const { client, server } = createInProcessPair(2);
	let closed = 0;
	client.onClose(() => closed++);
	server.onClose(() => closed++);
	for (let i = 0; i < 3; i++) client.send({ method: "x", params: {} });
	await tick();
	expect(closed).toBe(2);
});
```

`tick()` here waits for the transports' own queued deliveries (microtasks and the write chain), not for a race to resolve.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/app-server/transport.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `transport.ts`**

```ts
import type { Message } from "@knightcode/app-server-protocol";

/** One connection's message channel. Received messages are unvalidated; `AppServer` checks them. */
export interface Transport {
	send(message: Message): void;
	onMessage(handler: (message: unknown) => void): void;
	/** The peer will send nothing more (stdin EOF). Output stays open until close() (§5.6). */
	onInputEnd(handler: () => void): void;
	onClose(handler: () => void): void;
	/** "drain" (default) delivers what was already sent, then closes; "abort" drops it (§5.9). */
	close(mode?: "drain" | "abort"): void;
}
```

- [ ] **Step 4: Implement `stdio.ts`**

```ts
/**
 * ndjson over a readable and a line writer (§5.9). Logs belong on stderr; stdout carries only
 * protocol lines. LF framing only: payload strings may contain U+2028 and U+2029, which readline
 * would split on (modes/rpc/jsonl.ts explains). Limits count UTF-8 bytes.
 */

import type { Readable } from "node:stream";
import type { Message } from "@knightcode/app-server-protocol";
import { serializeJsonLine } from "../modes/rpc/jsonl.ts";
import type { Transport } from "./transport.ts";

export interface StdioLimits {
	/** Longest accepted line, in UTF-8 bytes. Images arrive base64 inside turn/start. */
	maxLineBytes: number;
	/** Written-but-unflushed output, in UTF-8 bytes, past which the client counts as gone. */
	maxPendingBytes: number;
}

export const DEFAULT_STDIO_LIMITS: StdioLimits = { maxLineBytes: 64 * 1024 * 1024, maxPendingBytes: 64 * 1024 * 1024 };

const NEWLINE = 0x0a;

export function createStdioTransport(
	input: Readable,
	write: (text: string) => Promise<void>,
	limits: StdioLimits = DEFAULT_STDIO_LIMITS,
): Transport {
	const messageHandlers: Array<(message: unknown) => void> = [];
	const inputEndHandlers: Array<() => void> = [];
	const closeHandlers: Array<() => void> = [];
	let state: "open" | "draining" | "closed" = "open";
	let reading = true;
	let pending = 0;
	let tail: Promise<void> = Promise.resolve();

	const finish = () => {
		if (state === "closed") return;
		state = "closed";
		stopReading();
		for (const handler of closeHandlers) handler();
	};

	const close = (mode: "drain" | "abort" = "drain") => {
		if (state !== "open") {
			if (mode === "abort") finish();
			return;
		}
		stopReading();
		if (mode === "abort") return finish();
		state = "draining";
		void tail.then(finish);
	};

	const send = (message: Message) => {
		if (state !== "open") return;
		const text = serializeJsonLine(message);
		const bytes = Buffer.byteLength(text, "utf8");
		pending += bytes;
		if (pending > limits.maxPendingBytes) {
			// The client stopped reading stdout. Buffering without bound would exhaust memory.
			process.stderr.write("app-server: the client is not reading its output; closing the connection\n");
			return close("abort");
		}
		const done = () => {
			pending -= bytes;
		};
		// After an abort, lines still queued here are dropped rather than written. A failed write (EPIPE: the
		// reader closed its end) means nothing more can be delivered: abort, so AppServer sees the close and
		// shutdown runs in order, instead of a second exit path.
		tail = tail
			.then(() => (state === "closed" ? undefined : write(text)))
			.then(done, (error: unknown) => {
				done();
				process.stderr.write(`app-server: writing stdout failed (${error instanceof Error ? error.message : String(error)}); closing the connection\n`);
				close("abort");
			});
	};

	const tooLong = () =>
		send({ method: "error", params: { message: `Line longer than ${limits.maxLineBytes} bytes; dropped` } });

	const handleLine = (raw: Buffer) => {
		const decoded = raw.toString("utf8");
		const line = decoded.endsWith("\r") ? decoded.slice(0, -1) : decoded;
		if (line.trim() === "") return;
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch (error) {
			// No id to answer: JSON-RPC's parse error becomes an error notification.
			send({ method: "error", params: { message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` } });
			return;
		}
		for (const handler of messageHandlers) handler(message);
	};

	/** The current line's bytes so far. 0x0A never occurs inside a multibyte character, so splits are safe. */
	let parts: Buffer[] = [];
	let size = 0;
	/** Inside an oversized line: drop input up to its newline. */
	let discarding = false;

	const onData = (chunk: string | Buffer) => {
		let data = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
		for (;;) {
			const newline = data.indexOf(NEWLINE);
			const piece = newline === -1 ? data : data.subarray(0, newline);
			if (!discarding) {
				if (size + piece.length > limits.maxLineBytes) {
					tooLong();
					discarding = true;
					parts = [];
					size = 0;
				} else {
					parts.push(piece);
					size += piece.length;
				}
			}
			if (newline === -1) return;
			data = data.subarray(newline + 1);
			if (discarding) {
				// The newline ends the oversized line.
				discarding = false;
				continue;
			}
			const line = Buffer.concat(parts, size);
			parts = [];
			size = 0;
			handleLine(line);
		}
	};

	/** EOF or a closed stdin: read the last line, stop reading, and say so. Output stays open. */
	const endInput = () => {
		if (!reading) return;
		if (!discarding && size > 0) {
			const line = Buffer.concat(parts, size);
			parts = [];
			size = 0;
			handleLine(line);
		}
		stopReading();
		for (const handler of inputEndHandlers) handler();
	};

	function stopReading() {
		if (!reading) return;
		reading = false;
		input.off("data", onData);
		input.off("end", endInput);
		input.off("close", endInput);
	}

	input.on("data", onData);
	input.on("end", endInput);
	input.on("close", endInput);
	return {
		send,
		onMessage: (handler) => messageHandlers.push(handler),
		onInputEnd: (handler) => inputEndHandlers.push(handler),
		onClose: (handler) => closeHandlers.push(handler),
		close,
	};
}
```

Each chunk is scanned once, unlike the string reader in `attachJsonlLineReader`, which rescans its buffer for every chunk of a long line.

- [ ] **Step 5: Implement `in-process.ts`**

Task 7 adds `createInProcessClient` here.

```ts
import type { Message } from "@knightcode/app-server-protocol";
import type { Transport } from "./transport.ts";

const DEFAULT_CAPACITY = 10_000;
/** Queued behind everything a draining end sent; reaching it closes both ends. */
const CLOSE = Symbol("close");

interface End {
	transport: Transport;
	deliver(message: Message): void;
	deliverClose(): void;
	shut(): void;
}

function createEnd(capacity: number, peer: () => End): End {
	const messageHandlers: Array<(message: unknown) => void> = [];
	const closeHandlers: Array<() => void> = [];
	const queue: Array<Message | typeof CLOSE> = [];
	let scheduled = false;
	let closing = false;
	let closed = false;
	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		queueMicrotask(flush);
	};
	const flush = () => {
		scheduled = false;
		while (queue.length > 0 && !closed) {
			const item = queue.shift()!;
			if (item === CLOSE) {
				end.shut();
				peer().shut();
				return;
			}
			for (const handler of messageHandlers) handler(item);
		}
	};
	const end: End = {
		deliver(message) {
			if (closed) return;
			if (queue.length >= capacity) {
				// A peer that stopped consuming; growing without bound would hide it.
				end.shut();
				peer().shut();
				return;
			}
			queue.push(message);
			schedule();
		},
		deliverClose() {
			if (closed) return;
			queue.push(CLOSE);
			schedule();
		},
		shut() {
			if (closed) return;
			closed = true;
			queue.length = 0;
			for (const handler of closeHandlers) handler();
		},
		transport: {
			// Messages pass as objects, not copies: receivers must not mutate what they get.
			send: (message) => {
				if (!closed && !closing) peer().deliver(message);
			},
			onMessage: (handler) => messageHandlers.push(handler),
			// No half-close in process: a peer's close() ends both directions (onClose), after its queued messages.
			onInputEnd: () => {},
			onClose: (handler) => closeHandlers.push(handler),
			close: (mode = "drain") => {
				if (closed) return;
				if (mode === "abort") {
					end.shut();
					peer().shut();
					return;
				}
				// Stop sending; the peer receives what is already queued, then both ends close.
				closing = true;
				peer().deliverClose();
			},
		},
	};
	return end;
}

/** Two connected transports over bounded in-memory queues, with stdio's envelopes. */
export function createInProcessPair(capacity = DEFAULT_CAPACITY): { client: Transport; server: Transport } {
	const client: End = createEnd(capacity, () => server);
	const server: End = createEnd(capacity, () => client);
	return { client: client.transport, server: server.transport };
}
```

`queueMicrotask` delivers before the test's `setTimeout(0)` tick, which is the ordering the tests rely on.

- [ ] **Step 6: Run tests, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/transport.test.ts`
Expected: PASS.

Run: `bun run check-types`

```bash
git add packages/cli/src/app-server/transport.ts packages/cli/src/app-server/stdio.ts packages/cli/src/app-server/in-process.ts packages/cli/test/app-server/transport.test.ts
git commit -m "feat(cli): add stdio and in-process app server transports"
```

---

### Task 7: `AppServer` connection core and `AppServerClient`

**Files:**
- Create: `packages/cli/src/app-server/server.ts`, `packages/cli/src/app-server/client.ts`, `packages/cli/src/app-server/errors.ts`, `packages/cli/test/app-server/server.test.ts`
- Modify: `packages/cli/src/app-server/in-process.ts` (add `createInProcessClient`)

**Interfaces:**
- Consumes: `Transport`, `createInProcessPair` (Task 6); protocol tables (Task 1).
- Produces:
  - `class AppServerError extends Error { readonly code: ErrorCode; readonly data?: unknown }` in `errors.ts`, plus `class SubscriberGone extends Error`.
  - `class Commit<R> { readonly run: () => R }` and `commitOnSend<R>(run: () => R): Commit<R>`: a result computed in the same tick the response is written (§4.5).
  - `type Handlers = { [M in ClientMethod]?: (params: ParamsOf<M>, connection: AppServer) => Promise<ResultOf<M> | Commit<ResultOf<M>>> }`
  - `interface Subscriber { readonly id: number; readonly mode: "desktop" | "tui"; readonly isClosed: boolean; notify<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void; request<M extends ServerRequestMethod>(method: M, params: ServerRequestParams<M>, signal: AbortSignal): Promise<ServerRequestResult<M>> }`
  - `class AppServer implements Subscriber` with `constructor(options: { transport: Transport; mode: "desktop" | "tui"; version: string; handlers: Handlers; onInitialized?(c: AppServer): void; onInputEnd?(c: AppServer): void; onClose?(c: AppServer): void })`, `close(): void`, `endInput(): void`.
  - `class AppServerClient` with `request<M extends ClientMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>>`, `notify(method: "initialized", params: {}): void`, `onNotification(handler: (method: string, params: unknown) => void): () => void`, `onRequest<M extends ServerRequestMethod>(method: M, handler: (params: ServerRequestParams<M>) => Promise<ServerRequestResult<M>>): void`, `close(): void`; `initialize(name?: string): Promise<ResultOf<"initialize">>` sends `initialize` then `initialized`.
  - `createInProcessClient(options: { handlers: Handlers; version: string; mode?: "desktop" | "tui"; onInitialized?; onClose? }): AppServerClient` — `mode` defaults to `"tui"`.

`mode` is the extension mode for threads this connection starts (§2 Extension mode): stdio is `"desktop"`, in-process is `"tui"`.

`Commit` exists for `thread/resume` (§4.5): the handler awaits the load, then returns a commit that copies the running turn and subscribes the connection. `AppServer` runs it immediately before writing the response, in the same synchronous step, so no notification can fall between the copy and the subscription. `isClosed` lets the thread manager skip subscribing a connection that closed while its load was in flight (Task 9).

Closing drains (Task 6): a `versionMismatch` error is delivered before the connection ends.

End of input (§5.6): when the transport reports EOF, or a signal calls `endInput()`, the connection stops taking new work but finishes what it accepted. It keeps a set of the requests it is dispatching; output closes (drained) once that set is empty. Server requests it sent are rejected with `SubscriberGone` at once, since no answer can arrive, so an approval moves on or resolves as cancelled. `isClosed` turns true at EOF too, so a load that finishes afterwards does not subscribe it. A request that still arrives after `endInput()` (a signal while stdin is open) answers `shuttingDown`. Whether an accepted request completes or is cancelled is the handler's business: shutdown (Task 9) cancels starts in preflight and fails loads with `shuttingDown`, and either way the answer is written.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/app-server/server.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { PROTOCOL_VERSION } from "@knightcode/app-server-protocol";
import { expect, test } from "vitest";
import { AppServerError } from "../../src/app-server/errors.ts";
import { createInProcessClient } from "../../src/app-server/in-process.ts";
import { AppServer, commitOnSend, type Handlers } from "../../src/app-server/server.ts";
import { createStdioTransport } from "../../src/app-server/stdio.ts";

const handlers: Handlers = {
	"model/list": async () => ({ models: [], default: null }),
	"thread/read": async ({ threadId }) => {
		throw new AppServerError("threadNotFound", `unknown thread: ${threadId}`);
	},
};

test("a method before initialize answers notInitialized", async () => {
	const client = createInProcessClient({ handlers, version: "0.0.0" });
	await expect(client.request("model/list", {})).rejects.toMatchObject({ code: "notInitialized" });
});

test("a wrong protocolVersion answers versionMismatch and closes", async () => {
	const client = createInProcessClient({ handlers, version: "0.0.0" });
	await expect(
		client.request("initialize", { clientInfo: { name: "t", version: "1" }, protocolVersion: PROTOCOL_VERSION + 1, capabilities: {} }),
	).rejects.toMatchObject({ code: "versionMismatch" });
	await expect(client.request("model/list", {})).rejects.toThrow("closed");
});

test("after the handshake, methods dispatch, params are validated, unknown methods are refused", async () => {
	const client = createInProcessClient({ handlers, version: "1.2.3" });
	expect(await client.initialize()).toEqual({ serverInfo: { name: "knightcode", version: "1.2.3" }, protocolVersion: PROTOCOL_VERSION });
	expect(await client.request("model/list", {})).toEqual({ models: [], default: null });
	await expect(client.request("thread/read", { threadId: "x" })).rejects.toMatchObject({ code: "threadNotFound" });
	await expect(client.request("thread/read", { threadId: 7 } as never)).rejects.toMatchObject({ code: "invalidParams" });
	await expect(client.request("thread/start", { cwd: "/p" })).rejects.toMatchObject({ code: "methodNotFound" });
});

test("server requests round-trip and are rejected with SubscriberGone on close", async () => {
	let connection: AppServer | undefined;
	const client = createInProcessClient({ handlers, version: "0", onInitialized: (c) => (connection = c) });
	client.onRequest("item/toolCall/requestApproval", async () => ({ decision: "accept" }));
	await client.initialize();
	const params = { threadId: "t", turnId: "u", itemId: "i", tool: "bash", input: {} };
	expect(await connection!.request("item/toolCall/requestApproval", params, new AbortController().signal)).toEqual({
		decision: "accept",
	});
	client.onRequest("item/toolCall/requestApproval", () => new Promise(() => {}));
	const pending = connection!.request("item/toolCall/requestApproval", params, new AbortController().signal);
	client.close();
	await expect(pending).rejects.toMatchObject({ name: "SubscriberGone" });
});

test("aborting a server request tells the client it was cancelled", async () => {
	let connection: AppServer | undefined;
	const client = createInProcessClient({ handlers, version: "0", onInitialized: (c) => (connection = c) });
	const seen: string[] = [];
	client.onNotification((method) => seen.push(method));
	client.onRequest("item/toolCall/requestApproval", () => new Promise(() => {}));
	await client.initialize();
	const controller = new AbortController();
	const pending = connection!.request(
		"item/toolCall/requestApproval",
		{ threadId: "t", turnId: "u", itemId: "i", tool: "bash", input: {} },
		controller.signal,
	);
	controller.abort();
	await expect(pending).rejects.toThrow();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(seen).toContain("serverRequest/cancelled");
});

test("a request still running when stdin ends is answered, and only then does output close", async () => {
	const input = new PassThrough();
	const written: Array<{ id?: number }> = [];
	const transport = createStdioTransport(input, async (text) => {
		written.push(JSON.parse(text));
	});
	let entered!: () => void;
	const running = new Promise<void>((resolve) => (entered = resolve));
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	let inputEnded!: () => void;
	const ended = new Promise<void>((resolve) => (inputEnded = resolve));
	let closed = false;
	const outputClosed = new Promise<void>((resolve) =>
		transport.onClose(() => {
			closed = true;
			resolve();
		}),
	);
	new AppServer({
		transport,
		mode: "desktop",
		version: "0",
		handlers: {
			"model/list": async () => {
				entered();
				await released;
				return { models: [], default: null };
			},
		},
		onInputEnd: () => inputEnded(),
	});
	const line = (message: unknown) => `${JSON.stringify(message)}\n`;
	input.write(
		line({ id: 1, method: "initialize", params: { clientInfo: { name: "t", version: "1" }, protocolVersion: PROTOCOL_VERSION, capabilities: {} } }),
	);
	input.write(line({ method: "initialized", params: {} }));
	input.write(line({ id: 2, method: "model/list", params: {} }));
	await running;
	input.end();
	await ended;
	expect(closed).toBe(false);
	release();
	await outputClosed;
	expect(written.map((m) => m.id)).toEqual([1, 2]);
});

test("a committed result is computed when the response is written, and isClosed follows the connection", async () => {
	let committed = false;
	let connection: AppServer | undefined;
	const client = createInProcessClient({
		handlers: {
			...handlers,
			"thread/unsubscribe": async () =>
				commitOnSend(() => {
					committed = true;
					return {};
				}),
		},
		version: "0",
		onInitialized: (c) => (connection = c),
	});
	await client.initialize();
	expect(committed).toBe(false);
	expect(await client.request("thread/unsubscribe", { threadId: "t" })).toEqual({});
	expect(committed).toBe(true);
	expect(connection!.isClosed).toBe(false);
	client.close();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(connection!.isClosed).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/app-server/server.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `errors.ts`**

```ts
import type { ErrorCode } from "@knightcode/app-server-protocol";

/** A failure the client can act on; becomes a response error with this code. */
export class AppServerError extends Error {
	readonly code: ErrorCode;
	readonly data?: unknown;

	constructor(code: ErrorCode, message: string, data?: unknown) {
		super(message);
		this.name = "AppServerError";
		this.code = code;
		this.data = data;
	}
}

/** The connection a server request went to closed before answering. */
export class SubscriberGone extends Error {
	constructor() {
		super("the client disconnected");
		this.name = "SubscriberGone";
	}
}
```

- [ ] **Step 4: Implement `server.ts`**

```ts
/**
 * One app server connection (§4.1, §5.1).
 *
 * Owns the handshake, validates every incoming message against the protocol
 * schemas, dispatches requests to handlers, and keeps the table of requests
 * it has sent the client. Transport-agnostic: stdio and in-process share it.
 */

import {
	ClientRequests,
	type ClientMethod,
	Envelope,
	type Message,
	type NotificationMethod,
	type NotificationParams,
	type ParamsOf,
	PROTOCOL_VERSION,
	type RequestId,
	type ResultOf,
	type ServerRequestMethod,
	type ServerRequestParams,
	type ServerRequestResult,
	ServerRequests,
} from "@knightcode/app-server-protocol";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { AppServerError, SubscriberGone } from "./errors.ts";
import type { Transport } from "./transport.ts";

/**
 * A result computed at the moment the response is written (§4.5). thread/resume copies a running turn
 * and subscribes in the same synchronous step that sends the response, so no notification falls between.
 */
export class Commit<R> {
	readonly run: () => R;

	constructor(run: () => R) {
		this.run = run;
	}
}

export function commitOnSend<R>(run: () => R): Commit<R> {
	return new Commit(run);
}

export type Handlers = {
	[M in ClientMethod]?: (params: ParamsOf<M>, connection: AppServer) => Promise<ResultOf<M> | Commit<ResultOf<M>>>;
};

export interface Subscriber {
	readonly id: number;
	readonly mode: "desktop" | "tui";
	/** True once the connection closed or its input ended; a load that finishes later must not subscribe it. */
	readonly isClosed: boolean;
	notify<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void;
	request<M extends ServerRequestMethod>(
		method: M,
		params: ServerRequestParams<M>,
		signal: AbortSignal,
	): Promise<ServerRequestResult<M>>;
}

export interface AppServerOptions {
	transport: Transport;
	mode: "desktop" | "tui";
	version: string;
	handlers: Handlers;
	onInitialized?(connection: AppServer): void;
	/** stdin ended (or endInput() was called): start shutting down. The connection still answers what it accepted. */
	onInputEnd?(connection: AppServer): void;
	onClose?(connection: AppServer): void;
}

const validators = new Map<TSchema, ReturnType<typeof Compile>>();
function check(schema: TSchema, value: unknown): boolean {
	let validator = validators.get(schema);
	if (!validator) {
		validator = Compile(schema);
		validators.set(schema, validator);
	}
	return validator.Check(value);
}

let nextConnectionId = 1;

interface Outgoing {
	resolve(result: unknown): void;
	reject(error: Error): void;
	resultSchema: TSchema;
}

export class AppServer implements Subscriber {
	readonly id = nextConnectionId++;
	readonly mode: "desktop" | "tui";
	private readonly transport: Transport;
	private readonly options: AppServerOptions;
	private state: "new" | "initializing" | "ready" | "closed" = "new";
	private nextRequestId = 1;
	private readonly outgoing = new Map<RequestId, Outgoing>();
	/** Requests accepted and not yet answered; after EOF, output closes once this is empty (§5.6). */
	private readonly dispatching = new Set<Promise<void>>();
	private inputEnded = false;

	constructor(options: AppServerOptions) {
		this.options = options;
		this.mode = options.mode;
		this.transport = options.transport;
		this.transport.onMessage((message) => this.receive(message));
		this.transport.onInputEnd(() => this.endInput());
		this.transport.onClose(() => this.closed());
	}

	notify<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void {
		if (this.state === "ready") this.transport.send({ method, params });
	}

	request<M extends ServerRequestMethod>(
		method: M,
		params: ServerRequestParams<M>,
		signal: AbortSignal,
	): Promise<ServerRequestResult<M>> {
		if (this.state === "closed") return Promise.reject(new SubscriberGone());
		if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
		const id = this.nextRequestId++;
		return new Promise<ServerRequestResult<M>>((resolve, reject) => {
			const onAbort = () => {
				if (!this.outgoing.delete(id)) return;
				this.notify("serverRequest/cancelled", { id });
				reject(signal.reason instanceof Error ? signal.reason : new Error("aborted"));
			};
			signal.addEventListener("abort", onAbort, { once: true });
			this.outgoing.set(id, {
				resolve: (result) => {
					signal.removeEventListener("abort", onAbort);
					resolve(result as ServerRequestResult<M>);
				},
				reject: (error) => {
					signal.removeEventListener("abort", onAbort);
					reject(error);
				},
				resultSchema: ServerRequests[method].result,
			});
			this.transport.send({ id, method, params });
		});
	}

	get isClosed(): boolean {
		return this.state === "closed" || this.inputEnded;
	}

	/** Drains by default (§5.9): what was already sent still reaches the client. */
	close(mode: "drain" | "abort" = "drain"): void {
		this.transport.close(mode);
	}

	/**
	 * No more input: stdin ended, or the process got a signal. Take no new work, finish what was accepted,
	 * then close output (§5.6). Server requests can no longer be answered, so they fail as a disconnect would.
	 */
	endInput(): void {
		if (this.inputEnded || this.state === "closed") return;
		this.inputEnded = true;
		for (const pending of this.outgoing.values()) pending.reject(new SubscriberGone());
		this.outgoing.clear();
		this.options.onInputEnd?.(this);
		this.closeWhenAnswered();
	}

	private closeWhenAnswered(): void {
		if (this.inputEnded && this.dispatching.size === 0 && this.state !== "closed") this.close("drain");
	}

	private closed(): void {
		if (this.state === "closed") return;
		this.state = "closed";
		for (const pending of this.outgoing.values()) pending.reject(new SubscriberGone());
		this.outgoing.clear();
		this.options.onClose?.(this);
	}

	private receive(message: unknown): void {
		if (!check(Envelope, message)) {
			this.transport.send({ method: "error", params: { message: "Malformed message" } });
			return;
		}
		const envelope = message as Message;
		if ("method" in envelope && "id" in envelope) {
			if (this.inputEnded) {
				this.transport.send({ id: envelope.id, error: { code: "shuttingDown", message: "the app server is shutting down" } });
				return;
			}
			const work = this.handleRequest(envelope.id, envelope.method, envelope.params);
			this.dispatching.add(work);
			void work.finally(() => {
				this.dispatching.delete(work);
				this.closeWhenAnswered();
			});
			return;
		}
		if ("method" in envelope) return this.handleNotification(envelope.method);
		const pending = this.outgoing.get(envelope.id);
		if (!pending) return;
		this.outgoing.delete(envelope.id);
		if ("error" in envelope) pending.reject(new AppServerError(envelope.error.code, envelope.error.message));
		else if (check(pending.resultSchema, envelope.result)) pending.resolve(envelope.result);
		else pending.reject(new AppServerError("invalidParams", "Malformed result"));
	}

	private handleNotification(method: string): void {
		if (method === "initialized" && this.state === "initializing") {
			this.state = "ready";
			this.options.onInitialized?.(this);
		}
	}

	private async handleRequest(id: RequestId, method: string, params: unknown): Promise<void> {
		try {
			const value = await this.dispatch(method, params);
			if (this.state === "closed") return;
			// A commit runs in the same synchronous step as the send (§4.5); a closed connection never runs it.
			const result = value instanceof Commit ? value.run() : value;
			this.transport.send({ id, result });
		} catch (error) {
			if (this.state === "closed" && !(error instanceof AppServerError && error.code === "versionMismatch")) return;
			const failure =
				error instanceof AppServerError
					? { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) }
					: { code: "internal" as const, message: error instanceof Error ? error.message : String(error) };
			this.transport.send({ id, error: failure });
			if (failure.code === "versionMismatch") this.close();
		}
	}

	private async dispatch(method: string, params: unknown): Promise<unknown> {
		if (!(method in ClientRequests)) throw new AppServerError("methodNotFound", `unknown method: ${method}`);
		const schemas = ClientRequests[method as ClientMethod];
		if (!check(schemas.params, params)) throw new AppServerError("invalidParams", `invalid params for ${method}`);
		if (method === "initialize") return this.initialize(params as ParamsOf<"initialize">);
		if (this.state !== "ready") throw new AppServerError("notInitialized", "send initialize and initialized first");
		const handler = this.options.handlers[method as ClientMethod] as
			| ((params: unknown, connection: AppServer) => Promise<unknown>)
			| undefined;
		if (!handler) throw new AppServerError("methodNotFound", `${method} is not available`);
		return handler(params, this);
	}

	private initialize(params: ParamsOf<"initialize">): ResultOf<"initialize"> {
		if (this.state !== "new") throw new AppServerError("invalidParams", "already initialized");
		if (params.protocolVersion !== PROTOCOL_VERSION) {
			throw new AppServerError(
				"versionMismatch",
				`client speaks protocol ${params.protocolVersion}, server speaks ${PROTOCOL_VERSION}`,
			);
		}
		this.state = "initializing";
		return { serverInfo: { name: "knightcode", version: this.options.version }, protocolVersion: PROTOCOL_VERSION };
	}
}
```

The versionMismatch response must reach the client before the connection ends; `handleRequest` sends it, then `close()`, which drains (Task 6).

- [ ] **Step 5: Implement `client.ts`**

```ts
/** A protocol client over any transport: tests use it, and Phase D's terminal will. */

import {
	type ClientMethod,
	type ParamsOf,
	PROTOCOL_VERSION,
	type RequestId,
	type ResultOf,
	type ServerRequestMethod,
	type ServerRequestParams,
	type ServerRequestResult,
} from "@knightcode/app-server-protocol";
import { AppServerError } from "./errors.ts";
import type { Transport } from "./transport.ts";

type RequestHandler = (params: unknown) => Promise<unknown>;

export class AppServerClient {
	private readonly transport: Transport;
	private nextId = 1;
	private closed = false;
	private readonly pending = new Map<RequestId, { resolve(v: unknown): void; reject(e: Error): void }>();
	private readonly notificationHandlers = new Set<(method: string, params: unknown) => void>();
	private readonly requestHandlers = new Map<string, RequestHandler>();

	constructor(transport: Transport) {
		this.transport = transport;
		transport.onMessage((message) => void this.receive(message as Record<string, unknown>));
		transport.onClose(() => {
			this.closed = true;
			for (const p of this.pending.values()) p.reject(new Error("connection closed"));
			this.pending.clear();
		});
	}

	request<M extends ClientMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
		if (this.closed) return Promise.reject(new Error("connection closed"));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve: (v) => resolve(v as ResultOf<M>), reject });
			this.transport.send({ id, method, params });
		});
	}

	notify(method: "initialized", params: Record<string, never>): void {
		this.transport.send({ method, params });
	}

	async initialize(name = "test"): Promise<ResultOf<"initialize">> {
		const result = await this.request("initialize", {
			clientInfo: { name, version: "0" },
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
		});
		this.notify("initialized", {});
		return result;
	}

	onNotification(handler: (method: string, params: unknown) => void): () => void {
		this.notificationHandlers.add(handler);
		return () => this.notificationHandlers.delete(handler);
	}

	onRequest<M extends ServerRequestMethod>(
		method: M,
		handler: (params: ServerRequestParams<M>) => Promise<ServerRequestResult<M>>,
	): void {
		this.requestHandlers.set(method, handler as RequestHandler);
	}

	close(): void {
		this.transport.close();
	}

	private async receive(message: Record<string, unknown>): Promise<void> {
		const id = message.id as RequestId | undefined;
		const method = message.method as string | undefined;
		if (method !== undefined && id !== undefined) {
			const handler = this.requestHandlers.get(method);
			if (!handler) {
				this.transport.send({ id, error: { code: "methodNotFound", message: method } });
				return;
			}
			try {
				this.transport.send({ id, result: await handler(message.params) });
			} catch (error) {
				this.transport.send({ id, error: { code: "internal", message: String(error) } });
			}
			return;
		}
		if (method !== undefined) {
			for (const handler of this.notificationHandlers) handler(method, message.params);
			return;
		}
		if (id === undefined) return;
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		const error = message.error as { code: string; message: string; data?: unknown } | undefined;
		if (error) pending.reject(new AppServerError(error.code as AppServerError["code"], error.message, error.data));
		else pending.resolve(message.result);
	}
}
```

Append to `in-process.ts`:

```ts
export interface InProcessClientOptions {
	handlers: Handlers;
	version: string;
	mode?: "desktop" | "tui";
	onInitialized?(connection: AppServer): void;
	onClose?(connection: AppServer): void;
}

/** A client connected to a fresh `AppServer` connection over an in-process pair. */
export function createInProcessClient(options: InProcessClientOptions): AppServerClient {
	const { client, server } = createInProcessPair();
	new AppServer({ ...options, transport: server, mode: options.mode ?? "tui" });
	return new AppServerClient(client);
}
```

with `import { AppServerClient } from "./client.ts";` and `import { AppServer, type Handlers } from "./server.ts";` at the top.

- [ ] **Step 6: Add the structured-error regression, then run tests, type check, commit**

In `server.test.ts`, throw `new AppServerError("archiveConflict", "destination exists", { source: "a", destination: "b", recoveryInstructions: ["Choose another archive destination"] })` from a handler. Assert the client's rejection has the same class, code, message and deeply equal `data`; repeat without data. Never stringify/drop recovery details.

Run: `cd packages/cli && bun x vitest --run test/app-server/server.test.ts test/app-server/transport.test.ts`
Expected: PASS.

Run: `bun run check-types`

```bash
git add packages/cli/src/app-server/server.ts packages/cli/src/app-server/client.ts packages/cli/src/app-server/errors.ts packages/cli/src/app-server/in-process.ts packages/cli/test/app-server/server.test.ts
git commit -m "feat(cli): add the app server connection and protocol client"
```

---

### Task 8: Context, accounts and models

**Files:**
- Create: `packages/cli/src/app-server/context.ts`, `accounts.ts`, `models.ts`, `packages/cli/test/app-server/accounts.test.ts`

**Interfaces:**
- Consumes: `Subscriber`, `Handlers`, `AppServerError` (Task 7).
- Produces:
  - `interface AppServerContext { models: ModelRuntime; credentials: CredentialStore; settings: SettingsManager; agentDir: string; sessionDir: string | undefined; defaultModel?: Model<Api>; connections: Set<Subscriber>; broadcast<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void }`
  - `createAppServerContext(options?: { agentDir?: string; sessionDir?: string; credentials?: CredentialStore; modelsPath?: string | null; settings?: SettingsManager; defaultModel?: Model<Api> }): Promise<AppServerContext>`
  - `accountHandlers(ctx: AppServerContext): Handlers` (`account/list`, `account/login/start`, `account/login/answer`, `account/login/cancel`, `account/logout`)
  - `modelHandlers(ctx: AppServerContext): Handlers` (`model/list`, `config/read`)

Restore sources from `954451f04^`:

```bash
git show 954451f04^:packages/cli/src/engine/context.ts > packages/cli/src/app-server/context.ts
git show 954451f04^:packages/cli/src/engine/accounts.ts > packages/cli/src/app-server/accounts.ts
git show 954451f04^:packages/cli/src/engine/models.ts > packages/cli/src/app-server/models.ts
```

Then adapt as below. The engine's event bus is not restored: `ctx.broadcast` replaces it, and only account events crossed it.

- [ ] **Step 1: Write the failing test**

`packages/cli/test/app-server/accounts.test.ts`:

```ts
import { fauxProvider } from "@knightcode/ai";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { accountHandlers } from "../../src/app-server/accounts.ts";
import { createAppServerContext } from "../../src/app-server/context.ts";
import { createInProcessClient } from "../../src/app-server/in-process.ts";
import { modelHandlers } from "../../src/app-server/models.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function connect() {
	const agentDir = mkdtempSync(join(tmpdir(), "knightcode-as-accounts-"));
	dirs.push(agentDir);
	const ctx = await createAppServerContext({ agentDir, credentials: new InMemoryCredentialStore(), modelsPath: null });
	const faux = fauxProvider({ provider: "faux-accounts" });
	ctx.models.registerNativeProvider(faux.provider);
	const client = createInProcessClient({
		handlers: { ...accountHandlers(ctx), ...modelHandlers(ctx) },
		version: "0",
		onInitialized: (c) => ctx.connections.add(c),
		onClose: (c) => ctx.connections.delete(c),
	});
	await client.initialize();
	return { ctx, faux, client };
}

test("model/list includes the faux model and names no default when none is set", async () => {
	const { faux, client } = await connect();
	const { models, default: chosen } = await client.request("model/list", {});
	expect(models.some((m) => m.provider === "faux-accounts" && m.id === faux.getModel().id)).toBe(true);
	expect(chosen).toBeNull();
});

test("account/list carries metadata only, and an unknown provider cannot start a login", async () => {
	const { client } = await connect();
	const { accounts } = await client.request("account/list", {});
	expect(JSON.stringify(accounts)).not.toMatch(/key|token/i);
	await expect(client.request("account/login/start", { provider: "nope", type: "api_key" })).rejects.toMatchObject({
		code: "invalidParams",
	});
});

test("account/logout broadcasts account/updated", async () => {
	const { client } = await connect();
	const seen: unknown[] = [];
	client.onNotification((method, params) => method === "account/updated" && seen.push(params));
	await client.request("account/logout", { provider: "faux-accounts" });
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(seen).toEqual([{ provider: "faux-accounts", authenticated: false }]);
});
```

Also restore the engine login tests as the base for registry behaviour:

```bash
git show 954451f04^:packages/cli/test/engine/login.test.ts > packages/cli/test/app-server/login.test.ts
```

Edit it to import `createLoginRegistry` from `../../src/app-server/accounts.ts` and `createAppServerContext`, drop HTTP-route cases, and keep the registry cases (timeout, cancel, submit, settled forgetting).

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/cli && bun x vitest --run test/app-server/accounts.test.ts test/app-server/login.test.ts`
Expected: FAIL, modules or exports missing.

- [ ] **Step 3: Adapt `context.ts`**

Replace the restored file with:

```ts
/**
 * Process-wide state every app server connection shares (§5.2).
 *
 * Credentials are shared with the terminal CLI: both use the same AuthStorage
 * over auth.json, which holds a cross-process lock. Anthropic rotates refresh
 * tokens, so two stores kept in step would leave one holding a dead token.
 */

import type { Api, CredentialStore, Model } from "@knightcode/ai";
import type { NotificationMethod, NotificationParams } from "@knightcode/app-server-protocol";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";
import { AuthStorage } from "../core/auth-storage.ts";
import { ModelRuntime } from "../core/model-runtime.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import type { Subscriber } from "./server.ts";

export interface AppServerContext {
	models: ModelRuntime;
	credentials: CredentialStore;
	/** Global scope only: the app server's own cwd is not a project anyone trusted. */
	settings: SettingsManager;
	agentDir: string;
	/** An explicit session dir (flag, env, settings), or undefined for the per-project default layout. */
	sessionDir: string | undefined;
	/** Tests pin threads to the faux model; production leaves this unset. */
	defaultModel?: Model<Api>;
	connections: Set<Subscriber>;
	broadcast<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void;
}

export interface CreateAppServerContextOptions {
	agentDir?: string;
	sessionDir?: string;
	credentials?: CredentialStore;
	/** `null` keeps the model catalog in memory. Tests pass null. */
	modelsPath?: string | null;
	settings?: SettingsManager;
	defaultModel?: Model<Api>;
}

export async function createAppServerContext(options: CreateAppServerContextOptions = {}): Promise<AppServerContext> {
	const agentDir = options.agentDir ?? getAgentDir();
	const credentials = options.credentials ?? AuthStorage.create(join(agentDir, "auth.json"));
	const models = await ModelRuntime.create({
		credentials,
		modelsPath: options.modelsPath === undefined ? join(agentDir, "models.json") : options.modelsPath,
		allowModelNetwork: false,
	});
	const connections = new Set<Subscriber>();
	return {
		models,
		credentials,
		settings: options.settings ?? SettingsManager.create(process.cwd(), agentDir, { projectTrusted: false }),
		agentDir,
		sessionDir: options.sessionDir,
		defaultModel: options.defaultModel,
		connections,
		broadcast(method, params) {
			for (const connection of connections) connection.notify(method, params);
		},
	};
}
```

`AuthStorage.create(authPath)` (`core/auth-storage.ts:347`) takes the file path directly.

- [ ] **Step 4: Adapt `accounts.ts`**

Keep `loginOptions`, `SerializablePrompt`, `LoginState`, `createLoginRegistry` and `toSerializablePrompt` as restored, with these changes:

- Replace the `EngineContext` import with `AppServerContext`; delete the `http.ts` and `server.ts` imports and `accountsRoutes`.
- `createLoginRegistry(ctx, options)` gains `onUpdate?: (state: LoginState) => void` in `LoginRegistryOptions`. Call `report(record)` — a local `const report = (record: LoginRecord) => { const state = get(record.loginId); if (state) options.onUpdate?.(state); };` — after `notify` pushes an event, after `prompt` parks, and at the end of `settle`. Lift the `get` body into a local function so `report` can call it.
- On login success, replace the two `ctx.events.publish` calls with `ctx.broadcast("account/updated", { provider: providerId, authenticated: true });`.
- `LoginOption` and `AccountSummary` rename `providerId` to `provider` to match the protocol.

Add the handlers:

```ts
export function accountHandlers(ctx: AppServerContext): Handlers {
	const registry = createLoginRegistry(ctx, { onUpdate: (state) => ctx.broadcast("account/login/updated", state) });
	const known = (provider: string) => {
		if (!ctx.models.getProvider(provider)) throw new AppServerError("invalidParams", `unknown provider: ${provider}`);
	};
	return {
		"account/list": async () => {
			const stored = await ctx.credentials.list();
			return {
				accounts: stored.map((entry) => {
					const provider = ctx.models.getProvider(entry.providerId);
					return {
						provider: entry.providerId,
						providerName: provider?.name ?? entry.providerId,
						type: entry.type,
						isSubscription: entry.type === "oauth" && provider?.auth.oauth?.isSubscription === true,
					};
				}),
				loginOptions: loginOptions(ctx),
			};
		},
		"account/login/start": async ({ provider, type }) => {
			known(provider);
			const auth = ctx.models.getProvider(provider)!.auth;
			const supported = type === "oauth" ? auth.oauth !== undefined : auth.apiKey?.login !== undefined;
			if (!supported) throw new AppServerError("invalidParams", `${provider} has no ${type} login`);
			return registry.start(provider, type);
		},
		"account/login/answer": async ({ loginId, value }) => {
			if (!registry.submit(loginId, value)) throw new AppServerError("invalidParams", "no pending prompt");
			return {};
		},
		"account/login/cancel": async ({ loginId }) => {
			if (!registry.cancel(loginId)) throw new AppServerError("invalidParams", `unknown login: ${loginId}`);
			return {};
		},
		"account/logout": async ({ provider }) => {
			known(provider);
			await ctx.models.logout(provider);
			ctx.broadcast("account/updated", { provider, authenticated: false });
			return {};
		},
	};
}
```

- [ ] **Step 5: Adapt `models.ts`**

Replace the restored file with:

```ts
/**
 * Model catalog and effective settings.
 *
 * The desktop app hardcodes no model list. The default is the model the user
 * chose, read from the settings file the terminal also writes, never one the
 * server picks.
 */

import { SettingsManager } from "../core/settings-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../core/trust-manager.ts";
import { resolvePath } from "../utils/paths.ts";
import type { AppServerContext } from "./context.ts";
import type { Handlers } from "./server.ts";

export function modelHandlers(ctx: AppServerContext): Handlers {
	return {
		"model/list": async () => {
			const available = await ctx.models.getAvailable();
			const models = available.map((model) => ({
				provider: model.provider,
				providerName: ctx.models.getProvider(model.provider)?.name ?? model.provider,
				id: model.id,
				name: model.name,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning,
				input: [...model.input],
			}));
			// The terminal may have moved the choice since startup.
			await ctx.settings.reload();
			const provider = ctx.settings.getDefaultProvider();
			const id = ctx.settings.getDefaultModel();
			const chosen = provider && id ? models.find((m) => m.provider === provider && m.id === id) : undefined;
			return { models, default: chosen ? `${chosen.provider}/${chosen.id}` : null };
		},
		"config/read": async ({ cwd }) => {
			if (cwd === undefined) {
				await ctx.settings.reload();
				return { settings: ctx.settings.getSettings() };
			}
			const resolved = resolvePath(cwd);
			const trusted = !hasTrustRequiringProjectResources(resolved) || new ProjectTrustStore(ctx.agentDir).get(resolved) === true;
			return { settings: SettingsManager.create(resolved, ctx.agentDir, { projectTrusted: trusted }).getSettings() };
		},
	};
}
```

- [ ] **Step 6: Run tests, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/accounts.test.ts test/app-server/login.test.ts`
Expected: PASS.

Run: `bun run check-types`

```bash
git add packages/cli/src/app-server/context.ts packages/cli/src/app-server/accounts.ts packages/cli/src/app-server/models.ts packages/cli/test/app-server/accounts.test.ts packages/cli/test/app-server/login.test.ts
git commit -m "feat(cli): add app server accounts, models and settings methods"
```

---

### Task 9: `ThreadManager` and `LoadedThread`: one load path, lifecycle states, idle unload, shutdown

**Files:**
- Create: `packages/cli/src/app-server/threads.ts`, `loaded-thread.ts`, `session-files.ts`, `packages/cli/test/app-server/harness.ts`, `packages/cli/test/app-server/threads.test.ts`, `packages/cli/test/app-server/threads-construction.test.ts`, `packages/cli/test/app-server/fixtures/hold-session.ts`, `packages/cli/test/app-server/fixtures/gate-extension.ts`
- Modify: `packages/cli/src/core/session-manager.ts` (export `readSessionHeaderForDiscovery`; extract `findSessionFileInDir` from `findById` `:1868-1891`)

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 7, 8.
- Produces:
  - `session-manager.ts`: `findSessionFileInDir(dir: string, id: string, cwd?: string): string | undefined` (newest file whose header id matches; `cwd` filters by header cwd); `readSessionHeaderForDiscovery` exported.
  - `session-files.ts`: `ARCHIVE_DIR`, `liveDirFor(ctx, cwd): string`, `sessionDirs(ctx, archived?: boolean): Promise<string[]>`, `isArchivedPath(file): boolean`, `class SessionFileIndex { constructor(ctx); remember(id, file): void; find(id): Promise<string | undefined>; findAll(id): Promise<string[]> }`.
  - `class LoadedThread` with `id`, `session`, `file`, `projectCwd`, `subscribers`, `lastTurnSubscriber`, `approvalMode`, `allowed`, `pending`, `asks`, `state: "ready" | "closing" | "closed"`, `idleTimer`, `unsubscribeSession`; `busy: boolean`; `exclusive<T>(fn: () => Promise<T>): Promise<T>`; `hold<T>(fn: () => Promise<T>): Promise<T>`; `pendingStarts: Set<AbortController>`; `toThread(): Thread`; `notify(method, params)` (subscribers); `abortPending()`; `withdrawFrom(subscriber)`; `drain(): Promise<void>`; `dispose(reason?, targetSessionFile?, waitForQueue?): Promise<void>`.
  - `class ThreadManager` with `constructor(ctx, options?: ThreadManagerOptions)`, `start(params, by): Promise<Thread>`, `resume(threadId, by): Promise<Commit<ResultOf<"thread/resume">>>`, `ensureLoaded(threadId, mode): Promise<LoadedThread>`, `get(threadId): LoadedThread`, `subscribe(thread, by)`, `unsubscribe(threadId, by)`, `disconnect(by)`, `scheduleIdle(thread)`, `unload(threadId, reason?, targetSessionFile?, options?: { waitForQueue?: boolean }): Promise<void>`, `closeAll(): Promise<void>`, `loadedCount(): number`, `handlers(): Handlers`; `readonly files: SessionFileIndex`.
  - `interface ThreadManagerOptions { idleMs?: number; extensionPaths?: string[]; extraExtensions?: InlineExtension[]; disabledBuiltinExtensions?: string[] }`. `extraExtensions` and `disabledBuiltinExtensions` are how tests load fixtures and switch a built-in off, the same knobs the terminal's `--extension` and `--no-mcp` use.
  - Test harness `startServer(options?)` returning `{ ctx, threads, faux, cwd, sessionDir, agentDir, connect(mode?) }`, and `TestClient` with `client`, `notifications`, `waitFor(method, predicate?, ms?)`, `close()`; `waitForLine(stream, text)`.

Why the states (§5.6): load de-duplication alone leaves races. An unload that removes the thread from the map and then awaits disposal lets a resume in between open the file again while the old session still owns it. Two `turn/start`s can both pass an `isStreaming` check while the first is in preflight. A shutdown that ignores loads in flight leaks their locks. So each id is in at most one of `loading`, `threads` (ready) and `closing`; `ensureLoaded` is the only way in; work that needs an idle thread runs on the thread's queue.

Two gaps the design review found, and how this task closes them:

- A closing transition must not run beside a load of the same id. Trace: a resume opens the manager and parks in an extension factory; an archive sees no ready thread, takes the file's lock (the in-process lock is counted, so it succeeds), and moves the file; the resume finishes holding a manager on the old path. `transition` therefore reserves the id in `closing` first, so later requests wait, then waits for a load of that id already under way, and only then takes the thread and runs its step. `resume`'s commit checks the thread is still ready, so a resume whose answer would come after the archive disposed its thread answers `threadNotFound` instead of subscribing to a closed thread.
- Shutdown must wait for whole load operations, not only for sessions under construction. A resume first awaits `files.find`; `load()` registers nothing until that returns, so a `closeAll` in between saw an empty set, returned, and the resume went on to take the lock. `track()` registers each operation (start, resume, fork; `load()` itself for replacements) from its first step, refuses new ones with `shuttingDown` once shutdown began, and `closeAll` waits until the set is empty.

`resume` here returns the turns as `[]`; Task 10 fills them in and Task 11 adds the running turn's snapshot.

- [ ] **Step 1: Export header-id lookup from `SessionManager`**

In `session-manager.ts`, export `readSessionHeaderForDiscovery` (add `export`), and move the body of `findById`'s loop into an exported function that `findById` calls:

```ts
/**
 * The newest file in `dir` whose header id is `id`. Goes by the header, not the file name: an imported
 * transcript keeps its header id under a new file name. `cwd` filters by the header's cwd.
 */
export function findSessionFileInDir(dir: string, id: string, cwd?: string): string | undefined {
	const resolvedCwd = cwd === undefined ? undefined : resolvePath(cwd);
	let newest: { path: string; modified: number } | undefined;
	try {
		for (const file of readdirSync(dir)) {
			if (!file.endsWith(".jsonl")) continue;
			const path = join(dir, file);
			const header = readSessionHeaderForDiscovery(path);
			if (header?.id !== id) continue;
			if (resolvedCwd !== undefined && !sessionCwdMatches(getSessionHeaderCwd(header), resolvedCwd)) continue;
			const modified = statSync(path).mtimeMs;
			if (!newest || modified > newest.modified) newest = { path, modified };
		}
	} catch {
		// Exact session discovery is best-effort, matching list().
	}
	return newest?.path;
}
```

`findById` becomes:

```ts
	static findById(cwd: string, id: string, sessionDir?: string): string | undefined {
		const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
		const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
		return findSessionFileInDir(dir, id, filterCwd ? cwd : undefined);
	}
```

Keep `findById`'s existing comment about imported transcripts on `findSessionFileInDir`.

- [ ] **Step 2: Write the fixtures and the harness**

`packages/cli/test/app-server/fixtures/hold-session.ts`, run as a separate process:

```ts
/** Holds a session file's lock from another process, as a terminal would (§5.5). */
import { SessionManager } from "../../../src/core/session-manager.ts";

const manager = SessionManager.open(process.argv[2]);
process.stdout.write("locked\n");
process.stdin.resume();
process.stdin.on("end", () => {
	manager.close();
	process.exit(0);
});
```

`packages/cli/test/app-server/fixtures/gate-extension.ts`, to hold a thread's load open and record when sessions shut down:

```ts
import type { ExtensionAPI } from "../../../src/index.ts";

export interface Gate {
	extension: (knightcode: ExtensionAPI) => Promise<void>;
	/** Resolves when a load reaches the gate: the load is provably in flight. */
	entered: Promise<void>;
	open(): void;
	/** "session_shutdown" for every session of a thread that loaded this extension; tests add their own marks. */
	events: string[];
}

/**
 * An extension whose factory waits until the test opens the gate, so a load can be caught in flight.
 * `skip` lets that many loads through first (a replacement's target is the second load).
 */
export function createGate(skip = 0): Gate {
	let open!: () => void;
	let entered!: () => void;
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	const enteredPromise = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const events: string[] = [];
	return {
		extension: async (knightcode) => {
			knightcode.on("session_shutdown", () => {
				events.push("session_shutdown");
			});
			if (skip-- > 0) return;
			entered();
			await opened;
		},
		entered: enteredPromise,
		open,
		events,
	};
}
```

The shutdown tests prove `closeAll` waited by order, not by sleeping: a parked load that `closeAll` waits for is disposed (its `session_shutdown`) before `closeAll` resolves; one it forgot would be disposed after.

`packages/cli/test/app-server/harness.ts`:

```ts
import { fauxProvider } from "@knightcode/ai";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import type { AppServerClient } from "../../src/app-server/client.ts";
import { type AppServerContext, createAppServerContext } from "../../src/app-server/context.ts";
import { createInProcessClient } from "../../src/app-server/in-process.ts";
import { ThreadManager, type ThreadManagerOptions } from "../../src/app-server/threads.ts";

let counter = 0;
const cleanups: Array<() => Promise<void>> = [];

/** Call from afterEach. */
export async function cleanupServers(): Promise<void> {
	for (const cleanup of cleanups.splice(0)) await cleanup();
}

export interface TestClient {
	client: AppServerClient;
	notifications: Array<{ method: string; params: Record<string, unknown> }>;
	waitFor(method: string, predicate?: (params: Record<string, unknown>) => boolean, ms?: number): Promise<Record<string, unknown>>;
	close(): void;
}

export interface StartServerOptions extends ThreadManagerOptions {
	tokensPerSecond?: number;
	sessionDir?: string;
	agentDir?: string;
}

export async function startServer(options: StartServerOptions = {}) {
	const cwd = mkdtempSync(join(tmpdir(), "knightcode-as-cwd-"));
	const agentDir = options.agentDir ?? mkdtempSync(join(tmpdir(), "knightcode-as-agent-"));
	const sessionDir = options.sessionDir ?? mkdtempSync(join(tmpdir(), "knightcode-as-sessions-"));
	const faux = fauxProvider({ provider: `faux-as-${counter++}`, tokensPerSecond: options.tokensPerSecond });
	const ctx: AppServerContext = await createAppServerContext({
		agentDir,
		sessionDir,
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		// The root .env is auto-loaded with real keys; an unpinned thread could bill them.
		defaultModel: faux.getModel(),
	});
	ctx.models.registerNativeProvider(faux.provider);
	// The availability pass marks the faux provider configured, as test/virtual-models.test.ts does.
	await ctx.models.refresh({ allowNetwork: false });
	const threads = new ThreadManager(ctx, options);
	cleanups.push(async () => {
		await threads.closeAll();
		for (const dir of [cwd, agentDir, sessionDir]) rmSync(dir, { recursive: true, force: true });
	});
	const connect = async (mode: "desktop" | "tui" = "tui"): Promise<TestClient> => {
		const client = createInProcessClient({
			handlers: threads.handlers(),
			version: "0",
			mode,
			onInitialized: (c) => ctx.connections.add(c),
			onClose: (c) => {
				ctx.connections.delete(c);
				threads.disconnect(c);
			},
		});
		const notifications: TestClient["notifications"] = [];
		const waiters = new Set<() => void>();
		client.onNotification((method, params) => {
			notifications.push({ method, params: params as Record<string, unknown> });
			for (const wake of [...waiters]) wake();
		});
		await client.initialize();
		return {
			client,
			notifications,
			close: () => client.close(),
			waitFor(method, predicate = () => true, ms = 5_000) {
				return new Promise((resolve, reject) => {
					const find = () => notifications.find((n) => n.method === method && predicate(n.params));
					const hit = find();
					if (hit) return resolve(hit.params);
					const timer = setTimeout(() => {
						waiters.delete(wake);
						reject(new Error(`timed out waiting for ${method}`));
					}, ms);
					const wake = () => {
						const found = find();
						if (!found) return;
						clearTimeout(timer);
						waiters.delete(wake);
						resolve(found.params);
					};
					waiters.add(wake);
				});
			},
		};
	};
	return { ctx, threads, faux, cwd, sessionDir, agentDir, connect };
}

/** Resolves when `stream` prints a line equal to `text`. */
export function waitForLine(stream: Readable, text: string, ms = 15_000): Promise<void> {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timer = setTimeout(() => reject(new Error(`timed out waiting for "${text}"`)), ms);
		stream.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf8");
			if (buffer.split("\n").includes(text)) {
				clearTimeout(timer);
				resolve();
			}
		});
	});
}
```

`threads.handlers()` grows to cover every thread and turn method across Tasks 9-13; the harness needs nothing else. Account and model methods have their own test (Task 8).

- [ ] **Step 3: Write the failing tests**

`packages/cli/test/app-server/threads.test.ts`. Saved threads are written directly with `SessionManager`, so these tests need no `turn/start` (Task 11):

```ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, expect, test, vi } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { createGate } from "./fixtures/gate-extension.ts";
import { cleanupServers, startServer, waitForLine } from "./harness.ts";

afterEach(async () => {
	vi.useRealTimers();
	await cleanupServers();
});

const isLocked = (file: string) => lockfile.checkSync(file, { realpath: false });

/** A thread saved to disk and not loaded, as a previous run of the app server or a terminal leaves it. */
function savedThread(cwd: string, sessionDir: string): { id: string; file: string } {
	const manager = SessionManager.create(cwd, sessionDir);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 });
	const saved = { id: manager.getSessionId(), file: manager.getSessionFile()! };
	manager.close();
	return saved;
}

test("thread/start returns an idle thread on the pinned model and broadcasts thread/started", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const b = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	expect(thread).toMatchObject({ cwd, projectCwd: cwd, status: "idle", archived: false, approvalMode: "fullAccess" });
	expect(thread.model?.id).toBe(faux.getModel().id);
	await b.waitFor("thread/started", (p) => (p.thread as { id: string }).id === thread.id);
});

test("a thread a stdio-mode client starts defaults to ask", async () => {
	const { cwd, connect } = await startServer();
	const desktop = await connect("desktop");
	const { thread } = await desktop.client.request("thread/start", { cwd });
	expect(thread.approvalMode).toBe("ask");
});

test("thread/start refuses a missing cwd, and an unknown model leaves no thread behind", async () => {
	const { cwd, threads, connect } = await startServer();
	const a = await connect();
	await expect(a.client.request("thread/start", { cwd: join(cwd, "missing") })).rejects.toMatchObject({ code: "invalidParams" });
	await expect(a.client.request("thread/start", { cwd, model: { provider: "nope", id: "nope" } })).rejects.toMatchObject({
		code: "invalidParams",
	});
	expect(threads.loadedCount()).toBe(0);
});

test("two concurrent resumes of one saved thread share one live session", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	const b = await connect();
	await Promise.all([a.client.request("thread/resume", { threadId: id }), b.client.request("thread/resume", { threadId: id })]);
	expect(threads.loadedCount()).toBe(1);
	expect(threads.get(id).subscribers.size).toBe(2);
});

test("a resume that arrives while the thread unloads gets a new session after the old one let go", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/resume", { threadId: id });
	const old = threads.get(id).session;
	const unloading = threads.unload(id);
	const resumed = a.client.request("thread/resume", { threadId: id });
	await Promise.all([unloading, resumed]);
	expect(threads.loadedCount()).toBe(1);
	expect(threads.get(id).session).not.toBe(old);
});

test("a connection that closes while its load is in flight is not subscribed", async () => {
	const gate = createGate();
	const { cwd, threads, connect } = await startServer({ extraExtensions: [{ name: "gate", factory: gate.extension }] });
	const a = await connect();
	const watcher = await connect();
	const starting = a.client.request("thread/start", { cwd }).catch(() => undefined);
	await gate.entered;
	a.close();
	gate.open();
	await starting;
	const started = await watcher.waitFor("thread/started");
	const id = (started.thread as { id: string }).id;
	expect(threads.get(id).subscribers.size).toBe(0);
});

test("shutdown waits for a thread/start whose load is parked in an extension, and leaves no thread", async () => {
	const gate = createGate();
	const { cwd, threads, connect } = await startServer({ extraExtensions: [{ name: "gate", factory: gate.extension }] });
	const a = await connect();
	const starting = a.client.request("thread/start", { cwd }).catch((error: unknown) => error);
	await gate.entered;
	const closing = threads.closeAll().then(() => gate.events.push("closeAll"));
	gate.open();
	await closing;
	// The parked thread was disposed before closeAll resolved, so closeAll waited for it.
	expect(gate.events).toEqual(["session_shutdown", "closeAll"]);
	expect(await starting).toMatchObject({ code: "shuttingDown" });
	expect(threads.loadedCount()).toBe(0);
});

test("shutdown with a resume in flight leaves no thread and no lock", async () => {
	const gate = createGate();
	const { cwd, sessionDir, threads, connect } = await startServer({
		extraExtensions: [{ name: "gate", factory: gate.extension }],
	});
	const { id, file } = savedThread(cwd, sessionDir);
	const a = await connect();
	const resuming = a.client.request("thread/resume", { threadId: id }).catch((error: unknown) => error);
	await gate.entered;
	const closing = threads.closeAll().then(() => gate.events.push("closeAll"));
	gate.open();
	await closing;
	expect(gate.events).toEqual(["session_shutdown", "closeAll"]);
	expect(await resuming).toMatchObject({ code: "shuttingDown" });
	expect(threads.loadedCount()).toBe(0);
	expect(isLocked(file)).toBe(false);
});

test("a shutdown that starts while a resume is still finding its file waits for that resume", async () => {
	const { cwd, sessionDir, threads } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const order: string[] = [];
	// Started and shut down in one synchronous step: the resume is inside its first await, the file
	// lookup, before any session or lock exists.
	const resuming = threads.ensureLoaded(id, "tui").then(
		() => order.push("loaded"),
		(error: unknown) => order.push((error as { code?: string }).code ?? "error"),
	);
	const closing = threads.closeAll().then(() => order.push("closeAll"));
	await Promise.all([resuming, closing]);
	expect(order).toEqual(["shuttingDown", "closeAll"]);
	expect(threads.loadedCount()).toBe(0);
	expect(isLocked(file)).toBe(false);
});

test("a thread another process holds answers threadLockedElsewhere", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const holder = spawn(process.execPath, [join(import.meta.dirname, "fixtures/hold-session.ts"), file], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	try {
		await waitForLine(holder.stdout!, "locked");
		const a = await connect();
		await expect(a.client.request("thread/resume", { threadId: id })).rejects.toMatchObject({
			code: "threadLockedElsewhere",
		});
	} finally {
		holder.stdin!.end();
		await once(holder, "exit");
	}
});

test("a session file that fails to load leaves no thread and no lock", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	// The header id fails assertValidSessionId, which runs after the manager has taken the lock.
	const file = join(sessionDir, "2026-10-11T00-00-00-000Z_bad.jsonl");
	writeFileSync(
		file,
		[
			JSON.stringify({ type: "session", version: 3, id: "../escape", timestamp: "2026-10-11T00:00:00.000Z", cwd }),
			JSON.stringify({ type: "message", id: "e1", parentId: null, timestamp: "2026-10-11T00:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 } }),
			"",
		].join("\n"),
	);
	const a = await connect();
	await expect(a.client.request("thread/resume", { threadId: "../escape" })).rejects.toBeDefined();
	expect(threads.loadedCount()).toBe(0);
	expect(isLocked(file)).toBe(false);
});

test("a thread with no subscriber unloads after the idle timeout and releases its lock", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const { cwd, sessionDir, threads, connect } = await startServer({ idleMs: 60_000 });
	const { id, file } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/resume", { threadId: id });
	expect(isLocked(file)).toBe(true);
	await a.client.request("thread/unsubscribe", { threadId: id });
	await vi.advanceTimersByTimeAsync(60_001);
	expect(threads.loadedCount()).toBe(0);
	expect(isLocked(file)).toBe(false);
	await a.waitFor("thread/status/changed", (p) => p.threadId === id && p.status === "notLoaded");
});

test("the idle timer does not unload a busy thread", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const { cwd, sessionDir, threads, connect } = await startServer({ idleMs: 60_000 });
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/resume", { threadId: id });
	let finish!: () => void;
	void threads.get(id).hold(() => new Promise<void>((resolve) => (finish = resolve)));
	await a.client.request("thread/unsubscribe", { threadId: id });
	await vi.advanceTimersByTimeAsync(60_001);
	expect(threads.loadedCount()).toBe(1);
	finish();
	await vi.advanceTimersByTimeAsync(60_001);
	expect(threads.loadedCount()).toBe(0);
});
```

Use the real `CURRENT_SESSION_VERSION` for `version`. The failing-load test only means something if the file is found and opened: if `readSessionHeaderForDiscovery` itself rejects the bad id (so the request answers `threadNotFound` without taking the lock), make the load fail after the lock another way and keep the assertions; Task 2 already pins the `SessionManager` side of this guarantee.

`packages/cli/test/app-server/threads-construction.test.ts`, separate because it mocks a module for the whole file. It fails session construction after the services flushed an extension's virtual model, the window in which no `AgentSession` exists to dispose the route. The mock is a test double through `vi.mock`, not a production gate.

```ts
import { afterEach, expect, test, vi } from "vitest";
import type * as ServicesModule from "../../src/core/agent-session-services.ts";
import type { ExtensionAPI } from "../../src/index.ts";
import { cleanupServers, startServer } from "./harness.ts";

const failure = vi.hoisted(() => ({ on: false }));
vi.mock("../../src/core/agent-session-services.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof ServicesModule>();
	return {
		...actual,
		createAgentSessionFromServices: (...args: Parameters<typeof actual.createAgentSessionFromServices>) =>
			failure.on ? Promise.reject(new Error("session construction failed")) : actual.createAgentSessionFromServices(...args),
	};
});

afterEach(async () => {
	failure.on = false;
	await cleanupServers();
});

const virtual = (knightcode: ExtensionAPI) =>
	knightcode.registerVirtualModel({
		provider: "virt",
		id: "auto",
		name: "Auto",
		// Never called: the test only checks registration and release.
		route: (_request, ctx) => ({ model: ctx.modelRegistry.find("unused", "unused")!, thinkingLevel: "off" }),
	});

test("a load that fails after the services registered a virtual model leaves no route behind", async () => {
	const { cwd, ctx, threads, connect } = await startServer({ extraExtensions: [{ name: "virt", factory: virtual }] });
	const a = await connect();
	failure.on = true;
	await expect(a.client.request("thread/start", { cwd })).rejects.toMatchObject({ code: "internal" });
	expect(ctx.models.getModel("virt", "auto")).toBeUndefined();
	expect(threads.loadedCount()).toBe(0);
	failure.on = false;
	await a.client.request("thread/start", { cwd });
	expect(ctx.models.getModel("virt", "auto")).toBeDefined();
});
```

`unregisterVirtualModel` updates the model snapshot synchronously (`model-runtime.ts:962-968`), so `getModel` reflects the release at once.


- [ ] **Step 4: Run them to verify they fail**

Run: `cd packages/cli && bun x vitest --run test/app-server/threads.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 5: Implement `session-files.ts`**

```ts
/** Where session files live, and finding one by the id in its header (§5.8). */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { findSessionFileInDir, getDefaultSessionDir, readSessionHeaderForDiscovery } from "../core/session-manager.ts";
import { resolvePath } from "../utils/paths.ts";
import type { AppServerContext } from "./context.ts";

export const ARCHIVE_DIR = "archived";

export function liveDirFor(ctx: AppServerContext, cwd: string): string {
	return ctx.sessionDir ?? getDefaultSessionDir(resolvePath(cwd), ctx.agentDir);
}

/** Every session directory: the explicit one, or each project's under the agent dir; their `archived/` when asked. */
export async function sessionDirs(ctx: AppServerContext, archived = false): Promise<string[]> {
	let dirs: string[];
	if (ctx.sessionDir !== undefined) {
		dirs = [ctx.sessionDir];
	} else {
		const root = join(ctx.agentDir, "sessions");
		const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
		dirs = entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => join(root, e.name));
	}
	return (archived ? dirs.map((dir) => join(dir, ARCHIVE_DIR)) : dirs).filter((dir) => existsSync(dir));
}

export function isArchivedPath(file: string): boolean {
	return basename(dirname(file)) === ARCHIVE_DIR;
}

/**
 * Thread id to session file. Goes by the id in each file's header, not its name: an imported or
 * renamed transcript keeps its header id under another name. A remembered path is confirmed by
 * re-reading its header, so a moved or deleted file falls through to a scan.
 */
export class SessionFileIndex {
	private readonly ctx: AppServerContext;
	private readonly paths = new Map<string, string>();

	constructor(ctx: AppServerContext) {
		this.ctx = ctx;
	}

	remember(id: string, file: string): void {
		this.paths.set(id, file);
	}

	// ponytail: a miss reads every header in every session dir; keep a persistent index if that shows up.
	async find(id: string): Promise<string | undefined> {
		const known = this.paths.get(id);
		if (known && existsSync(known) && readSessionHeaderForDiscovery(known)?.id === id) return known;
		for (const archived of [false, true]) {
			for (const dir of await sessionDirs(this.ctx, archived)) {
				const file = findSessionFileInDir(dir, id);
				if (file) {
					this.paths.set(id, file);
					return file;
				}
			}
		}
		this.paths.delete(id);
		return undefined;
	}

	/** Every file whose header id is `id`, live and archived. More than one is a duplicate to report, never to pick from. */
	async findAll(id: string): Promise<string[]> {
		const found: string[] = [];
		for (const archived of [false, true]) {
			for (const dir of await sessionDirs(this.ctx, archived)) {
				for (const name of await readdir(dir).catch((): string[] => [])) {
					if (!name.endsWith(".jsonl")) continue;
					const path = join(dir, name);
					if (readSessionHeaderForDiscovery(path)?.id === id) found.push(path);
				}
			}
		}
		return found;
	}
}
```

- [ ] **Step 6: Implement `loaded-thread.ts`**

```ts
/** One live thread: its session, subscribers, approval state, lifecycle state and operation queue (§5.1, §5.6). */

import type { ApprovalMode, NotificationMethod, NotificationParams, Thread } from "@knightcode/app-server-protocol";
import type { AgentSession } from "../core/agent-session.ts";
import { emitSessionShutdownEvent } from "../core/extensions/runner.ts";
import { AppServerError, SubscriberGone } from "./errors.ts";
import type { Subscriber } from "./server.ts";
import { isArchivedPath } from "./session-files.ts";

const TITLE_LENGTH = 200;

export function titleOf(name: string | undefined, firstMessage: string): string {
	const source = name || firstMessage.split("\n", 1)[0].trim();
	let title = "";
	let previous = "";
	let count = 0;
	for (const point of source) {
		if (count === TITLE_LENGTH) return `${previous}…`;
		previous = title;
		title += point;
		count++;
	}
	return title;
}

export class LoadedThread {
	readonly id: string;
	readonly session: AgentSession;
	readonly projectCwd: string;
	readonly subscribers = new Set<Subscriber>();
	lastTurnSubscriber: Subscriber | undefined;
	approvalMode: ApprovalMode;
	readonly allowed = new Set<string>();
	/** Abort controllers of server requests in flight for this thread. */
	readonly pending = new Set<AbortController>();
	/**
	 * Each open server request's current attempt and the subscriber it went to (Task 12). Unsubscribing or
	 * disconnecting that subscriber withdraws the attempt, so the request moves on (§4.5).
	 */
	readonly asks = new Set<{ target: Subscriber; controller: AbortController }>();
	/** ready → closing → closed. A closing thread takes no new work. */
	state: "ready" | "closing" | "closed" = "ready";
	idleTimer: ReturnType<typeof setTimeout> | undefined;
	unsubscribeSession: () => void = () => {};
	/** turn/starts not yet launched (Task 11), from before they queue. turn/interrupt and dispose abort them all. */
	readonly pendingStarts = new Set<AbortController>();
	/** Requests holding the thread: queued or running operations, one-off changes. */
	private ops = 0;
	private queue: Promise<unknown> = Promise.resolve();
	private readonly onActivityEnd: () => void;

	constructor(session: AgentSession, projectCwd: string, approvalMode: ApprovalMode, onActivityEnd: () => void) {
		this.id = session.sessionManager.getSessionId();
		this.session = session;
		this.projectCwd = projectCwd;
		this.approvalMode = approvalMode;
		this.onActivityEnd = onActivityEnd;
	}

	get file(): string | undefined {
		return this.session.sessionManager.getSessionFile();
	}

	/** Busy threads are never unloaded by the idle timer: a request holds them, or a run or compaction is going. */
	get busy(): boolean {
		return this.ops > 0 || this.pendingStarts.size > 0 || !this.session.isIdle;
	}

	/** Count `fn` as activity, so the idle timer leaves the thread alone until it ends. */
	async hold<T>(fn: () => Promise<T>): Promise<T> {
		this.ops++;
		try {
			return await fn();
		} finally {
			this.ops--;
			this.onActivityEnd();
		}
	}

	/** Run `fn` after every earlier exclusive operation on this thread (§5.6). */
	exclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.queue.then(() => {
			if (this.state !== "ready") throw new AppServerError("threadNotFound", `thread is closing: ${this.id}`);
			return fn();
		});
		this.queue = run.catch(() => {});
		return this.hold(() => run);
	}

	toThread(): Thread {
		const { session } = this;
		const model = session.model;
		const firstUser = session.messages.find((m) => m.role === "user");
		const firstText =
			firstUser && Array.isArray(firstUser.content)
				? firstUser.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join(" ")
				: typeof firstUser?.content === "string"
					? firstUser.content
					: "";
		return {
			id: this.id,
			cwd: session.sessionManager.getCwd(),
			projectCwd: this.projectCwd,
			name: titleOf(session.sessionManager.getSessionName(), firstText),
			status: session.isIdle ? "idle" : "active",
			archived: this.file !== undefined && isArchivedPath(this.file),
			updatedAt: session.sessionManager.getLeafEntry()?.timestamp ?? session.sessionManager.getHeader()?.timestamp ?? "",
			workspace: { mode: "local" },
			approvalMode: this.approvalMode,
			...(model ? { model: { provider: model.provider, id: model.id, name: model.name, contextWindow: model.contextWindow } } : {}),
			thinkingLevel: session.thinkingLevel,
		};
	}

	notify<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void {
		for (const subscriber of this.subscribers) subscriber.notify(method, params);
	}

	abortPending(): void {
		for (const controller of [...this.pending]) controller.abort(new Error("Tool call cancelled"));
		this.pending.clear();
	}

	/** `subscriber` left: every request attempt that went to it fails as a disconnect would, and moves on. */
	withdrawFrom(subscriber: Subscriber): void {
		for (const ask of [...this.asks]) {
			if (ask.target === subscriber) ask.controller.abort(new SubscriberGone());
		}
	}

	/** Resolves when every operation queued so far has ended. The queue promise never rejects. */
	drain(): Promise<void> {
		return this.queue.then(() => {});
	}

	/**
	 * The engine's close order (sessions.ts:325-339), with cancellation first so the queue drains fast:
	 * a pending turn/start stops before launching, pending approvals resolve as cancelled, a run or
	 * compaction aborts and settles (the mapper still sees agent_settled, so subscribers get
	 * turn/completed). Then the queue drains, extensions hear session_shutdown, and the session is
	 * disposed, which closes the manager and releases the lock (Task 2). Operations queued but not
	 * started fail fast: `exclusive` refuses a thread that is not ready.
	 *
	 * `waitForQueue: false` is for a replacement: its caller is a command running on this queue.
	 */
	async dispose(reason: "quit" | "new" | "resume" | "fork" = "quit", targetSessionFile?: string, waitForQueue = true): Promise<void> {
		if (this.state === "closed") return;
		this.state = "closing";
		clearTimeout(this.idleTimer);
		for (const start of this.pendingStarts) start.abort();
		this.abortPending();
		try {
			await this.session.abort();
			if (waitForQueue) await this.drain();
		} finally {
			this.unsubscribeSession();
			await emitSessionShutdownEvent(this.session.extensionRunner, { type: "session_shutdown", reason, targetSessionFile });
			this.session.dispose();
			this.state = "closed";
		}
	}
}
```

Entry and header timestamps are ISO strings (`timestamp: string`, `session-manager.ts:47,61`), so they pass through unchanged; a thread with no entries yet uses its header's. `SessionShutdownEvent` is `{ type, reason, targetSessionFile? }` (`core/extensions/types.ts:818-823`).

- [ ] **Step 7: Implement `threads.ts`**

```ts
/**
 * Every live thread in the process (§5). Grows out of the engine's
 * createSessionRegistry (git show 954451f04^:packages/cli/src/engine/sessions.ts):
 * open de-duplication, close order and preflight come from there. The states
 * and the single load path are §5.6.
 */

import { stat } from "node:fs/promises";
import type { ApprovalMode, ParamsOf, ResultOf, Thread } from "@knightcode/app-server-protocol";
import type { AgentSession } from "../core/agent-session.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../core/agent-session-services.ts";
import type { InlineExtension } from "../core/extensions/types.ts";
import { SessionHardLinkedError, SessionLockedError } from "../core/session-lock.ts";
import { SessionManager } from "../core/session-manager.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../core/trust-manager.ts";
import { builtInExtensions } from "../extensions/index.ts";
import { resolvePath } from "../utils/paths.ts";
import type { AppServerContext } from "./context.ts";
import { AppServerError } from "./errors.ts";
import { LoadedThread } from "./loaded-thread.ts";
import { type Commit, commitOnSend, type Handlers, type Subscriber } from "./server.ts";
import { liveDirFor, SessionFileIndex } from "./session-files.ts";

const DEFAULT_IDLE_MS = 10 * 60_000;

export interface ThreadManagerOptions {
	idleMs?: number;
	/** `-e` paths: loaded in every thread as trusted CLI extensions. */
	extensionPaths?: string[];
	/** Inline extensions after the built-ins. Tests load fixtures here. */
	extraExtensions?: InlineExtension[];
	/** Built-ins to leave out, as the terminal's --no-mcp does. */
	disabledBuiltinExtensions?: string[];
}

export function defaultApprovalMode(mode: "desktop" | "tui"): ApprovalMode {
	return mode === "desktop" ? "ask" : "fullAccess";
}

export class ThreadManager {
	readonly files: SessionFileIndex;
	private readonly ctx: AppServerContext;
	private readonly options: ThreadManagerOptions;
	private readonly idleMs: number;
	/** Ready threads only (§5.6). */
	private readonly threads = new Map<string, LoadedThread>();
	private readonly loading = new Map<string, Promise<LoadedThread>>();
	/** Unloads and archive moves in progress, as settled promises; a load of the same id waits for them. */
	private readonly closing = new Map<string, Promise<void>>();
	/** Every load operation (start, resume, fork, a replacement's load), from its first step; shutdown waits for all. */
	private readonly inFlight = new Set<Promise<unknown>>();
	private shuttingDown = false;

	constructor(ctx: AppServerContext, options: ThreadManagerOptions = {}) {
		this.ctx = ctx;
		this.options = options;
		this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
		this.files = new SessionFileIndex(ctx);
	}

	loadedCount(): number {
		return this.threads.size;
	}

	get(threadId: string): LoadedThread {
		const thread = this.threads.get(threadId);
		if (!thread) throw new AppServerError("threadNotFound", `thread is not loaded: ${threadId}`);
		return thread;
	}

	private assertOpen(): void {
		if (this.shuttingDown) throw new AppServerError("shuttingDown", "the app server is shutting down");
	}

	/**
	 * Run a load operation as one tracked unit from its first step (§5.6): closeAll waits for it, and once
	 * shutdown began no new one starts. A resume's first await is the file lookup, before any session exists.
	 */
	private track<T>(operation: () => Promise<T>): Promise<T> {
		if (this.shuttingDown) return Promise.reject(new AppServerError("shuttingDown", "the app server is shutting down"));
		const work = operation();
		this.inFlight.add(work);
		const done = () => this.inFlight.delete(work);
		void work.then(done, done);
		return work;
	}

	start(params: ParamsOf<"thread/start">, by: Subscriber): Promise<Thread> {
		return this.track(async () => {
			const cwd = resolvePath(params.cwd);
			const stats = await stat(cwd).catch(() => undefined);
			if (!stats?.isDirectory()) throw new AppServerError("invalidParams", `cwd is not a directory: ${params.cwd}`);
			const sessionManager = SessionManager.create(cwd, liveDirFor(this.ctx, cwd));
			const thread = await this.load(sessionManager, by.mode, "new", params.approvalMode ?? defaultApprovalMode(by.mode));
			try {
				if (params.model) await this.setModel(thread, params.model.provider, params.model.id);
				if (params.thinkingLevel) thread.session.setThinkingLevel(params.thinkingLevel);
			} catch (error) {
				// A thread the client never got must not stay loaded.
				await this.unload(thread.id);
				throw error;
			}
			this.subscribe(thread, by);
			const summary = thread.toThread();
			this.ctx.broadcast("thread/started", { thread: summary });
			return summary;
		});
	}

	async resume(threadId: string, by: Subscriber): Promise<Commit<ResultOf<"thread/resume">>> {
		const thread = await this.ensureLoaded(threadId, by.mode);
		// Subscribe in the same tick as the response is written (§4.5).
		return commitOnSend(() => {
			// An unload or archive may have taken the thread between the load and this answer (§5.6).
			if (thread.state !== "ready") throw new AppServerError("threadNotFound", `thread was closed: ${threadId}`);
			this.subscribe(thread, by);
			return { thread: thread.toThread(), turns: [] };
		});
	}

	/** The only way to a loaded thread (§5.6). Never two sessions on one file. */
	async ensureLoaded(threadId: string, mode: "desktop" | "tui"): Promise<LoadedThread> {
		for (;;) {
			this.assertOpen();
			const closing = this.closing.get(threadId);
			if (closing) {
				// The old session must release the file (or the archive move finish) first.
				await closing.catch(() => {});
				continue;
			}
			const live = this.threads.get(threadId);
			if (live) return live;
			const inFlight = this.loading.get(threadId);
			if (inFlight) return inFlight;
			const loading = this.track(() => this.loadSaved(threadId, mode));
			this.loading.set(threadId, loading);
			try {
				return await loading;
			} finally {
				this.loading.delete(threadId);
			}
		}
	}

	private async loadSaved(threadId: string, mode: "desktop" | "tui"): Promise<LoadedThread> {
		const file = await this.files.find(threadId);
		if (!file) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
		// Shutdown may have begun during the lookup; do not take a lock it would have to release.
		this.assertOpen();
		let sessionManager: SessionManager;
		try {
			sessionManager = SessionManager.open(file);
		} catch (error) {
			if (error instanceof SessionLockedError) {
				throw new AppServerError("threadLockedElsewhere", "the thread is open in another KnightCode process");
			}
			if (error instanceof SessionHardLinkedError) {
				// An archive move interrupted between link and unlink (§5.8): report every name, open none.
				const paths = await this.files.findAll(threadId);
				throw new AppServerError("archiveConflict", error.message, {
					reason: "duplicateLinks",
					paths,
					recoveryInstructions: [
						"These names are one file. Keep the one in the directory where the thread belongs and delete the other name, then open the thread again.",
					],
				});
			}
			throw error;
		}
		return this.load(sessionManager, mode, "resume");
	}

	subscribe(thread: LoadedThread, by: Subscriber): void {
		// A connection that closed while its load was in flight never gets a subscription it cannot drop.
		if (by.isClosed) return this.scheduleIdle(thread);
		thread.subscribers.add(by);
		clearTimeout(thread.idleTimer);
		thread.idleTimer = undefined;
	}

	unsubscribe(threadId: string, by: Subscriber): void {
		const thread = this.threads.get(threadId);
		if (!thread) return;
		thread.subscribers.delete(by);
		if (thread.lastTurnSubscriber === by) thread.lastTurnSubscriber = undefined;
		// An approval waiting on `by` would otherwise wait for a dialog it may no longer show (§4.5).
		thread.withdrawFrom(by);
		this.scheduleIdle(thread);
	}

	disconnect(by: Subscriber): void {
		for (const thread of this.threads.values()) {
			if (thread.subscribers.has(by)) this.unsubscribe(thread.id, by);
		}
	}

	/** Start the idle timer when nobody watches and nothing holds the thread (§5.6). */
	scheduleIdle(thread: LoadedThread): void {
		if (thread.state !== "ready" || thread.subscribers.size > 0 || thread.busy || thread.idleTimer) return;
		thread.idleTimer = setTimeout(() => {
			thread.idleTimer = undefined;
			// Something may have started since the timer was set.
			if (thread.subscribers.size === 0 && !thread.busy) void this.unload(thread.id);
		}, this.idleMs);
		thread.idleTimer.unref?.();
	}

	/**
	 * Run `step` as the id's one closing transition (§5.6). Unload and archive both use it. The id is
	 * reserved in `closing` at once, so later requests wait; a ready thread leaves the ready map in the
	 * same step. A load of the id already under way finishes first, and its thread is taken then: closing
	 * around it would leave its session on a file the step moves. The map holds the same settled promise it
	 * later compares against, and a step waits only on the transition before it, never on its own entry.
	 */
	private transition(threadId: string, step: (thread: LoadedThread | undefined) => Promise<void>): Promise<void> {
		const previous = this.closing.get(threadId);
		const ready = this.threads.get(threadId);
		this.threads.delete(threadId);
		const work = (async () => {
			await previous;
			await this.loading.get(threadId)?.catch(() => {});
			const thread = ready ?? this.threads.get(threadId);
			this.threads.delete(threadId);
			await step(thread);
		})();
		const entry = work.then(
			() => undefined,
			() => undefined,
		);
		this.closing.set(threadId, entry);
		void entry.then(() => {
			if (this.closing.get(threadId) === entry) this.closing.delete(threadId);
		});
		return work;
	}

	/** Moves the thread from ready to closing in one step, so no request sees it in neither. */
	async unload(
		threadId: string,
		reason: "quit" | "new" | "resume" | "fork" = "quit",
		targetSessionFile?: string,
		options: { waitForQueue?: boolean } = {},
	): Promise<void> {
		if (!this.threads.has(threadId)) return this.closing.get(threadId);
		await this.transition(threadId, (thread) => thread!.dispose(reason, targetSessionFile, options.waitForQueue ?? true));
		this.ctx.broadcast("thread/status/changed", { threadId, status: "notLoaded" });
	}

	/** Refuse new loads, wait for every load operation in flight, then unload everything in parallel (§5.6). */
	async closeAll(): Promise<void> {
		this.shuttingDown = true;
		// Loop: an operation may still be inside track() when the snapshot is taken.
		while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
		await Promise.allSettled([...this.threads.keys()].map((id) => this.unload(id)));
		await Promise.allSettled([...this.closing.values()]);
	}

	private async setModel(thread: LoadedThread, provider: string, id: string): Promise<void> {
		const model = this.ctx.models.getModel(provider, id);
		if (!model) throw new AppServerError("invalidParams", `no such model: ${provider}/${id}`);
		try {
			await thread.session.setModel(model);
		} catch (error) {
			throw new AppServerError("authRequired", error instanceof Error ? error.message : String(error));
		}
	}

	/**
	 * Every session build goes through here. Tracked as well, so a replacement's load (Task 13), which no
	 * other operation wraps, is waited for; a manager the caller already opened is closed if shutdown refuses.
	 */
	private load(
		sessionManager: SessionManager,
		mode: "desktop" | "tui",
		reason: "new" | "resume" | "fork",
		approvalMode?: ApprovalMode,
	): Promise<LoadedThread> {
		const building = this.track(() => this.build(sessionManager, mode, reason, approvalMode)).catch((error: unknown) => {
			if (error instanceof AppServerError && error.code === "shuttingDown") sessionManager.close();
			throw error;
		});
		// Every build is visible by id while it runs (§5.6), not only those ensureLoaded starts. A fork's or a
		// replacement's file exists before its load finishes, so thread/list can show it: a resume of that id must
		// join this build instead of opening a second session on the file (the in-process lock is counted and would
		// let it), and an archive must wait for it. ensureLoaded's own entry, which also covers the file lookup,
		// stays in place when it is the caller.
		const id = sessionManager.getSessionId();
		if (!this.loading.has(id)) {
			this.loading.set(id, building);
			const clear = () => {
				if (this.loading.get(id) === building) this.loading.delete(id);
			};
			void building.then(clear, clear);
		}
		return building;
	}

	/**
	 * Build a session the way the terminal does (main.ts:844-975), over the shared ModelRuntime.
	 * `approvalMode` is the effective mode for a new thread; a resumed thread restores its own (Task 12).
	 */
	private async build(
		sessionManager: SessionManager,
		mode: "desktop" | "tui",
		reason: "new" | "resume" | "fork",
		approvalMode?: ApprovalMode,
	): Promise<LoadedThread> {
		const cwd = sessionManager.getCwd();
		let created: LoadedThread | undefined;
		let services: Awaited<ReturnType<typeof createAgentSessionServices>> | undefined;
		let session: AgentSession | undefined;
		try {
			const projectTrusted =
				!hasTrustRequiringProjectResources(cwd) || new ProjectTrustStore(this.ctx.agentDir).get(cwd) === true;
			const holder: { thread?: LoadedThread } = {};
			services = await createAgentSessionServices({
				cwd,
				agentDir: this.ctx.agentDir,
				modelRuntime: this.ctx.models,
				settingsManager: SettingsManager.create(cwd, this.ctx.agentDir, { projectTrusted }),
				resourceLoaderOptions: {
					extensionFactories: [...builtInExtensions, ...this.threadExtensions(holder), ...(this.options.extraExtensions ?? [])],
					additionalExtensionPaths: this.options.extensionPaths,
					disabledBuiltinExtensions: this.options.disabledBuiltinExtensions,
				},
			});
			({ session } = await createAgentSessionFromServices({
				services,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason },
				model: this.ctx.defaultModel,
			}));
			const thread = new LoadedThread(
				session,
				cwd,
				approvalMode ?? defaultApprovalMode(mode),
				() => this.scheduleIdle(thread),
			);
			created = thread;
			holder.thread = thread;
			await this.bind(thread, mode);
			// A shutdown that began during the load must not leave this thread behind.
			this.assertOpen();
			this.threads.set(thread.id, thread);
			if (thread.file) this.files.remember(thread.id, thread.file);
			// No model is fine: an extension provider may register later, and turn/start answers authRequired (§5.2).
			return thread;
		} catch (error) {
			// Disposing the thread or session closes the manager and releases the loader's cache leases (Task 5)
			// and its virtual-model routes (Task 4). Before a session exists, nothing else owns those: the
			// services flush already registered the routes, so release routes and leases, and close the manager.
			if (created) await created.dispose();
			else if (session) session.dispose();
			else {
				if (services) {
					this.ctx.models.releaseVirtualModels(services.resourceLoader.getExtensions().runtime);
					services.resourceLoader.releaseExtensionCache();
				}
				sessionManager.close();
			}
			throw error;
		}
	}

	/** Per-thread hidden extensions: Task 11 adds the model_select bridge, Task 12 approvals. */
	private threadExtensions(_holder: { thread?: LoadedThread }): InlineExtension[] {
		return [];
	}

	private async bind(thread: LoadedThread, mode: "desktop" | "tui"): Promise<void> {
		const { session } = thread;
		await session.bindExtensions({
			mode,
			onError: (error) => console.error(`Extension ${error.extensionPath}: ${error.error}`),
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				navigateTree: (targetId, options) => session.navigateTree(targetId, options),
				reload: () => session.reload(),
				// Task 13 replaces these three with thread replacement.
				newSession: async () => ({ cancelled: true }),
				fork: async () => ({ cancelled: true }),
				switchSession: async () => ({ cancelled: true }),
			},
		});
	}

	handlers(): Handlers {
		return {
			"thread/start": (params, connection) => this.start(params, connection).then((thread) => ({ thread })),
			"thread/resume": ({ threadId }, connection) => this.resume(threadId, connection),
			"thread/unsubscribe": async ({ threadId }, connection) => {
				this.unsubscribe(threadId, connection);
				return {};
			},
		};
	}
}
```

`createAgentSessionServices` takes `resourceLoaderOptions` with `extensionFactories`, `additionalExtensionPaths` and `disabledBuiltinExtensions` (the `DefaultResourceLoader` options, `resource-loader.ts:305`); `ModelRuntime.getModel(provider, id)` is what `main.ts:512` calls; `session.isIdle` is at `agent-session.ts:1497`. `resume`'s cursor parameter is wired in Task 10.

The `Subscriber` interface needs `readonly isClosed: boolean` (Task 7 adds it to `AppServer`).

- [ ] **Step 8: Run tests, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/threads.test.ts test/app-server/threads-construction.test.ts`
Expected: PASS.

Run: `bun run check-types`

```bash
git add packages/cli/src/core/session-manager.ts packages/cli/src/app-server/threads.ts packages/cli/src/app-server/loaded-thread.ts packages/cli/src/app-server/session-files.ts packages/cli/test/app-server/harness.ts packages/cli/test/app-server/threads.test.ts packages/cli/test/app-server/threads-construction.test.ts packages/cli/test/app-server/fixtures/hold-session.ts packages/cli/test/app-server/fixtures/gate-extension.ts
git commit -m "feat(cli): add the app server thread manager"
```

---

### Task 10: Reading turns back, and the thread methods that need no turn

**Files:**
- Create: `packages/cli/src/app-server/transcript.ts`, `packages/cli/test/app-server/transcript.test.ts`
- Modify: `packages/cli/src/app-server/threads.ts` (`resume` turns and cursor; handlers `thread/list`, `thread/read`, `thread/archive`, `thread/unarchive`, `thread/name/set`, `thread/fork`), `packages/cli/test/app-server/threads.test.ts`

**Interfaces:**
- Consumes: `isTurnMarker`, `isTurnEnd`, `parseTurnEnd` (Task 5); `ThreadManager`, `SessionFileIndex`, `titleOf` (Task 9); `commitOnSend` (Task 7).
- Produces:
  - `transcript.ts`: `readTurns(threadId: string, entries: readonly SessionEntry[], activeTurnId?: string): Turn[]` (only the turn with that id may read back `inProgress` with running calls); `toolCallStatus(isError: boolean, content): "completed" | "failed" | "declined"`; `entryForItem(entries, itemId): string | undefined`; `fileChangesOf(tool, input, isError): FileChange[]`; `outputOf(content): ToolOutput[]`; `textOf(content): string`; `DECLINED_REASON = "The user rejected this tool call"`; `CANCELLED_REASON = "Tool call cancelled"`.
  - `ThreadManager.list(params)`, `.read(threadId, cursor?)`, `.archive(threadId, archived)`, `.fork(threadId, atItemId, by)`, `.withThread(threadId, mode, fn)`, `.history(thread, entries, cursor?, runningTurn?)`.
  - `PayloadStore`, `pageHistory`, `ListingPages`, and `moveSessionFileWithoutReplace`, specified in Step 4a/4b.

The id rules are §4.2. The reader and Task 11's live mapper must produce identical ids and statuses, so both count with the same rules and take the status from the same end entry; Task 11's equality tests are the guard.

Two reads must never write (§5.5): `thread/read` on a saved file, and the source side of `thread/fork`. Both go through `loadEntriesFromFile`, which Task 2 made read-only, and build the tree with `SessionManager.inMemory`, whose rewrite path is a no-op.

Nested tool calls (code mode) are live-only (§4.2 table): the reader does not reconstruct them, and the equality tests compare top-level items.

- [ ] **Step 1: Write the failing reader test**

`packages/cli/test/app-server/transcript.test.ts`:

```ts
import { expect, test } from "vitest";
import { DECLINED_REASON, entryForItem, readTurns } from "../../src/app-server/transcript.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import { TURN_END_TYPE, TURN_MARKER_TYPE } from "../../src/extensions/turn-marker.ts";

let n = 0;
const base = () => ({ id: `e${n++}`, parentId: null, timestamp: "2026-10-11T00:00:00.000Z" });
const marker = (): SessionEntry => ({ ...base(), type: "custom", customType: TURN_MARKER_TYPE }) as SessionEntry;
const end = (status: string, error?: string): SessionEntry =>
	({ ...base(), type: "custom", customType: TURN_END_TYPE, data: error ? { status, error } : { status } }) as SessionEntry;
const user = (text: string): SessionEntry =>
	({ ...base(), type: "message", message: { role: "user", content: [{ type: "text", text }], timestamp: 0 } }) as SessionEntry;
const assistant = (content: unknown[], stopReason = "stop"): SessionEntry =>
	({ ...base(), type: "message", message: { role: "assistant", content, stopReason, timestamp: 0 } }) as SessionEntry;
const toolResult = (toolCallId: string, toolName: string, text: string, isError = false): SessionEntry =>
	({
		...base(),
		type: "message",
		message: { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: 0 },
	}) as SessionEntry;
const compaction = (summary: string): SessionEntry =>
	({ ...base(), type: "compaction", summary, firstKeptEntryId: "e0", tokensBefore: 0 }) as SessionEntry;

test("a marked turn keeps its steers, numbers items by ordinal and takes its status from the end entry", () => {
	const m = marker();
	const entries = [
		m,
		user("do it"),
		assistant([{ type: "thinking", thinking: "hmm" }, { type: "toolCall", id: "c1", name: "edit", arguments: { path: "a.ts" } }], "toolUse"),
		toolResult("c1", "edit", "ok"),
		user("also this"),
		assistant([{ type: "text", text: "done" }]),
		end("completed"),
	];
	const [turn] = readTurns("t", entries);
	expect(turn.id).toBe(m.id);
	expect(turn.status).toBe("completed");
	expect(turn.items.map((i) => i.id)).toEqual([`${m.id}:user:0`, `${m.id}:0:0`, "c1", `${m.id}:user:1`, `${m.id}:1:0`]);
	expect(turn.items[2]).toMatchObject({
		type: "toolCall",
		status: "completed",
		output: [{ type: "text", text: "ok" }],
		fileChanges: [{ path: "a.ts", kind: "modify" }],
	});
});

test("tool calls sit at their blocks in block order; results never reorder them; a call with no result failed", () => {
	const m = marker();
	const entries = [
		m,
		user("go"),
		assistant(
			[
				{ type: "toolCall", id: "w", name: "write", arguments: { path: "a.ts" } },
				{ type: "toolCall", id: "r", name: "read", arguments: { path: "b.ts" } },
			],
			"toolUse",
		),
		// Results in completion order, the reverse of block order.
		toolResult("r", "read", "b"),
		toolResult("w", "write", "ok"),
		assistant([{ type: "toolCall", id: "x", name: "bash", arguments: {} }], "aborted"),
		end("interrupted"),
	];
	const [turn] = readTurns("t", entries);
	expect(turn.items.map((i) => i.id)).toEqual([`${m.id}:user:0`, "w", "r", "x"]);
	expect(turn.items.find((i) => i.id === "x")).toMatchObject({ status: "failed", output: [] });
});

test("a retried failure counts as an assistant message, and the end entry wins over it", () => {
	const m = marker();
	const turns = readTurns("t", [m, user("go"), assistant([], "error"), assistant([{ type: "text", text: "ok" }]), end("completed")]);
	expect(turns[0].status).toBe("completed");
	expect(turns[0].items.map((i) => i.id)).toEqual([`${m.id}:user:0`, `${m.id}:1:0`]);
});

test("a marker without an end entry is interrupted unless the thread is running it", () => {
	const entries = [marker(), user("go"), assistant([{ type: "text", text: "partial" }], "toolUse")];
	expect(readTurns("t", entries)[0].status).toBe("interrupted");
	expect(readTurns("t", entries, entries[0].id)[0].status).toBe("inProgress");
});

test("an idle compaction after the end entry stays in that turn", () => {
	const m = marker();
	const turns = readTurns("t", [m, user("go"), assistant([{ type: "text", text: "a" }]), end("completed"), compaction("sum")]);
	expect(turns).toHaveLength(1);
	expect(turns[0].items.at(-1)).toMatchObject({ type: "compaction", id: `${m.id}:compaction:0`, summary: "sum" });
});

test("a session without markers reads back one turn per user message", () => {
	const first = user("one");
	const second = user("two");
	const turns = readTurns(
		"t",
		[first, assistant([{ type: "text", text: "a" }]), second, assistant([{ type: "text", text: "b" }], "aborted")],
	);
	expect(turns.map((t) => t.id)).toEqual([first.id, second.id]);
	expect(turns[1].status).toBe("interrupted");
});

test("a declined call reads back declined, a failed end reads back failed, an empty marked turn is dropped", () => {
	const entries = [
		marker(),
		user("x"),
		assistant([{ type: "toolCall", id: "c2", name: "bash", arguments: {} }], "toolUse"),
		toolResult("c2", "bash", DECLINED_REASON, true),
		assistant([], "error"),
		end("failed", "boom"),
		marker(),
	];
	const turns = readTurns("t", entries);
	expect(turns).toHaveLength(1);
	expect(turns[0].items.find((i) => i.id === "c2")).toMatchObject({ status: "declined" });
	expect(turns[0]).toMatchObject({ status: "failed", error: "boom" });
});

test("entryForItem finds the entry holding an item", () => {
	const m = marker();
	const u = user("hi");
	const a = assistant([{ type: "text", text: "yo" }]);
	expect(entryForItem([m, u, a], `${m.id}:user:0`)).toBe(u.id);
	expect(entryForItem([m, u, a], `${m.id}:0:0`)).toBe(a.id);
	expect(entryForItem([m, u, a], "nope")).toBeUndefined();
});
```

`CompactionEntry` has `summary`, `firstKeptEntryId` and `tokensBefore` (`session-manager.ts`, built in `appendCompaction` `:1255-1281`); the helper sets exactly those.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/cli && bun x vitest --run test/app-server/transcript.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `transcript.ts`**

```ts
/**
 * Turns and items read back from session entries (§4.2). Task 11's live
 * ItemMapper produces the same ids from session events, and both take a
 * marked turn's status from its end entry.
 */

import type { FileChange, Item, ToolOutput, Turn } from "@knightcode/app-server-protocol";
import type { SessionEntry } from "../core/session-manager.ts";
import { isTurnEnd, isTurnMarker, parseTurnEnd, type TurnEnd } from "../extensions/turn-marker.ts";

export const DECLINED_REASON = "The user rejected this tool call";
export const CANCELLED_REASON = "Tool call cancelled";

type Content = readonly { type: string; text?: string; data?: string; mimeType?: string }[];

export function textOf(content: string | Content): string {
	if (typeof content === "string") return content;
	return content.flatMap((c) => (c.type === "text" && c.text !== undefined ? [c.text] : [])).join("");
}

export function outputOf(content: Content): ToolOutput[] {
	return content.flatMap((c): ToolOutput[] =>
		c.type === "text"
			? [{ type: "text", text: c.text ?? "" }]
			: c.type === "image"
				? [{ type: "image", mimeType: c.mimeType ?? "", data: c.data ?? "" }]
				: [],
	);
}

/** A call the approval gate blocked has an error result carrying exactly the decline reason. */
export function toolCallStatus(isError: boolean, content: Content): "completed" | "failed" | "declined" {
	if (!isError) return "completed";
	return textOf(content) === DECLINED_REASON ? "declined" : "failed";
}

// ponytail: `write` reports "modify" even for a new file; Phase B's diff knows the truth.
export function fileChangesOf(tool: string, input: unknown, isError: boolean): FileChange[] {
	if (isError || (tool !== "edit" && tool !== "write")) return [];
	const path = typeof input === "object" && input !== null ? (input as { path?: unknown }).path : undefined;
	return typeof path === "string" ? [{ path, kind: "modify" }] : [];
}

interface Building {
	turn: Turn;
	marked: boolean;
	end?: TurnEnd;
	users: number;
	customs: number;
	compactions: number;
	assistants: number;
	lastStop?: string;
	lastError?: string;
	calls: Map<string, Extract<Item, { type: "toolCall" }>>;
	unresolved: Set<string>;
}

const isUser = (entry: SessionEntry) => entry.type === "message" && entry.message.role === "user";

export function readTurns(threadId: string, entries: readonly SessionEntry[], activeTurnId?: string): Turn[] {
	const turns: Building[] = [];
	let current: Building | undefined;
	const open = (id: string, marked: boolean) => {
		current = {
			turn: { id, threadId, status: "completed", items: [] },
			marked,
			users: 0,
			customs: 0,
			compactions: 0,
			assistants: 0,
			calls: new Map(),
			unresolved: new Set(),
		};
		turns.push(current);
	};
	for (const entry of entries) {
		if (isTurnMarker(entry)) {
			open(entry.id, true);
			continue;
		}
		if (isTurnEnd(entry)) {
			if (current?.marked) current.end = parseTurnEnd(entry.type === "custom" ? entry.data : undefined);
			continue;
		}
		if (isUser(entry) && !current?.marked) open(entry.id, false);
		if (!current) continue;
		const t = current;
		if (entry.type === "compaction") {
			t.turn.items.push({ type: "compaction", id: `${t.turn.id}:compaction:${t.compactions++}`, summary: entry.summary });
		} else if (entry.type === "custom_message") {
			t.turn.items.push({
				type: "extensionMessage",
				id: `${t.turn.id}:custom:${t.customs++}`,
				extension: entry.customType,
				text: textOf(entry.content as string | Content),
			});
		} else if (entry.type === "message") {
			const message = entry.message;
			if (message.role === "user") {
				const content = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content;
				t.turn.items.push({
					type: "userMessage",
					id: `${t.turn.id}:user:${t.users++}`,
					text: textOf(content as Content),
					images: (content as Content).flatMap((c) => (c.type === "image" ? [{ mimeType: c.mimeType ?? "", data: c.data ?? "" }] : [])),
				});
			} else if (message.role === "assistant") {
				// Counted per entry, as the live mapper counts at message_end (§4.2).
				const n = t.assistants++;
				message.content.forEach((block, index) => {
					if (block.type === "text") t.turn.items.push({ type: "agentMessage", id: `${t.turn.id}:${n}:${index}`, text: block.text });
					else if (block.type === "thinking")
						t.turn.items.push({ type: "reasoning", id: `${t.turn.id}:${n}:${index}`, text: block.thinking });
					else if (block.type === "toolCall") {
						const call: Extract<Item, { type: "toolCall" }> = {
							type: "toolCall",
							id: block.id,
							tool: block.name,
							input: block.arguments,
							status: "failed",
							output: [],
						};
						t.calls.set(block.id, call);
						t.unresolved.add(block.id);
						t.turn.items.push(call);
					}
				});
				t.lastStop = message.stopReason;
				t.lastError = message.errorMessage;
			} else if (message.role === "toolResult") {
				const call = t.calls.get(message.toolCallId);
				t.unresolved.delete(message.toolCallId);
				if (call) {
					call.status = toolCallStatus(message.isError, message.content as Content);
					call.output = outputOf(message.content as Content);
					// Part of the call item, so a result never adds or moves an item (§4.2).
					const changes = fileChangesOf(call.tool, call.input, message.isError);
					if (changes.length > 0) call.fileChanges = changes;
				}
			}
		}
	}
	const result = turns.filter((t) => t.turn.items.length > 0);
	result.forEach((t) => {
		const active = t.turn.id === activeTurnId;
		if (t.marked) {
			if (t.end) {
				t.turn.status = t.end.status;
				if (t.end.error) t.turn.error = t.end.error;
			} else t.turn.status = active ? "inProgress" : "interrupted";
		} else if (active) t.turn.status = "inProgress";
		else if (t.lastStop === "aborted") t.turn.status = "interrupted";
		else if (t.lastStop === "error") {
			t.turn.status = "failed";
			if (t.lastError) t.turn.error = t.lastError;
		}
		if (t.turn.status === "inProgress") {
			for (const id of t.unresolved) t.calls.get(id)!.status = "running";
		}
	});
	return result.map((t) => t.turn);
}

// ponytail: replays the reader per entry, O(n²) on the branch; index items while reading if fork latency shows up.
export function entryForItem(entries: readonly SessionEntry[], itemId: string): string | undefined {
	for (let i = 0; i < entries.length; i++) {
		const turns = readTurns("", entries.slice(0, i + 1));
		if (turns.some((t) => t.items.some((item) => item.id === itemId))) return entries[i].id;
	}
	return undefined;
}
```

The field names are the real ones: `CompactionEntry.summary`, `CustomMessageEntry.customType` and `content`, `CustomEntry.customType` and `data` (`session-manager.ts`); `ToolCall.arguments`, `ThinkingContent.thinking`, `AssistantMessage.errorMessage` (`packages/ai/src/types.ts`, and `fauxToolCall`/`fauxThinking` in `providers/faux.ts:58-75` build the same shapes).

- [ ] **Step 4: Add the thread methods to `threads.ts`**

Imports to add: `existsSync`, `statSync` from `node:fs`; `mkdir` from `node:fs/promises`; `basename`, `dirname`, `join` from `node:path`; `loadEntriesFromFile`, `type SessionEntry` from `../core/session-manager.ts`; `readTurns`, `entryForItem`, `textOf` from `./transcript.ts`; `ARCHIVE_DIR`, `isArchivedPath`, `sessionDirs` from `./session-files.ts`; `titleOf` from `./loaded-thread.ts`; `type ImageRef`, `type Turn` from the protocol.

`resume` takes the cursor and returns anchored history plus a separate current running snapshot (Task 11 attaches the mapper):

```ts
	async resume(threadId: string, cursor: string | undefined, by: Subscriber): Promise<Commit<ResultOf<"thread/resume">>> {
		const thread = await this.ensureLoaded(threadId, by.mode);
		// Read and subscribe in the same tick as the response is written (§4.5).
		return commitOnSend(() => {
			// An unload or archive may have taken the thread between the load and this answer (§5.6).
			if (thread.state !== "ready") throw new AppServerError("threadNotFound", `thread was closed: ${threadId}`);
			const summary = thread.toThread();
			const history = this.history(summary, thread.session.sessionManager.getBranch(), cursor, thread.mapper?.wireSnapshot());
			this.subscribe(thread, by);
			return { thread: summary, ...history };
		});
	}

	/** Only the mapper can identify the real active turn; isIdle alone cannot. */
	private liveTurns(thread: LoadedThread): Turn[] {
		return readTurns(thread.id, thread.session.sessionManager.getBranch(), thread.mapper?.currentTurnId());
	}
```

and the handler: `"thread/resume": ({ threadId, cursor }, connection) => this.resume(threadId, cursor, connection),`. Task 1's schema already has `cursor` on `thread/resume` params and `nextCursor` on its result.

Add to the class:

```ts
	private history(thread: Thread | ThreadSummary, entries: readonly SessionEntry[], cursor?: string, runningTurn?: WireTurn): HistoryPage {
		return pageHistory({ thread, entries, cursor, runningTurn }, this.payloads);
	}

	/** A saved file's active branch, read without loading, locking or writing it (§5.5). */
	private branchOf(file: string): { entries: SessionEntry[]; manager: SessionManager } {
		const manager = SessionManager.inMemory(process.cwd(), undefined, loadEntriesFromFile(file));
		return { entries: manager.getBranch(), manager };
	}

	async list(params: ParamsOf<"thread/list">): Promise<ResultOf<"thread/list">> {
		return this.listingPages.page(params, async () => {
		const archived = params.archived === true;
		let infos: SessionInfo[];
		if (params.cwd !== undefined) {
			// SessionManager.list filters by each header's cwd when the dir is shared (an explicit session dir).
			const cwd = resolvePath(params.cwd);
			const live = liveDirFor(this.ctx, cwd);
			const dir = archived ? join(live, ARCHIVE_DIR) : live;
			infos = existsSync(dir) ? await SessionManager.list(cwd, dir) : [];
		} else {
			infos = (await Promise.all((await sessionDirs(this.ctx, archived)).map((dir) => SessionManager.listAll(dir)))).flat();
		}
		const sorted = infos.filter((info) => info.messageCount > 0).sort((a, b) => b.modified.getTime() - a.modified.getTime());
		return sorted.map((info) => {
				const live = this.threads.get(info.id);
				return {
					id: info.id,
					cwd: info.cwd,
					projectCwd: info.cwd,
					name: titleOf(info.name, info.firstMessage),
					status: live ? (live.session.isIdle ? "idle" : "active") : "notLoaded",
					archived: isArchivedPath(info.path),
					updatedAt: info.modified.toISOString(),
				};
			});
		});
	}

	async read(threadId: string, cursor?: string): Promise<ResultOf<"thread/read">> {
		const live = this.threads.get(threadId);
		if (live) {
			const thread = live.toThread();
			return { thread, ...this.history(thread, live.session.sessionManager.getBranch(), cursor, live.mapper?.wireSnapshot()) };
		}
		const file = await this.files.find(threadId);
		if (!file) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
		const { entries, manager } = this.branchOf(file);
		const header = manager.getHeader();
		const firstUser = entries.find((e) => e.type === "message" && e.message.role === "user");
		const firstText =
			firstUser?.type === "message" && firstUser.message.role === "user" ? textOf(firstUser.message.content) : "";
		const thread: ThreadSummary = {
				id: threadId,
				cwd: header?.cwd ?? "",
				projectCwd: header?.cwd ?? "",
				name: titleOf(manager.getSessionName(), firstText),
				status: "notLoaded",
				archived: isArchivedPath(file),
				updatedAt: statSync(file).mtime.toISOString(),
		};
		return { thread, ...this.history(thread, entries, cursor) };
	}

	/** Load (without subscribing) for a one-off change, holding the thread so the idle timer waits for it. */
	async withThread<T>(threadId: string, mode: "desktop" | "tui", fn: (thread: LoadedThread) => Promise<T>): Promise<T> {
		const thread = await this.ensureLoaded(threadId, mode);
		return thread.hold(() => fn(thread));
	}

	/**
	 * Move a thread's file into or out of `archived/` (§5.8), as one closing transition with the unload
	 * (Task 9's `transition`): the id is reserved, a load of it already under way finishes, the thread is
	 * disposed if it is loaded, and the file moves, all before a resume racing it may load again. That
	 * resume then finds the file at its new path instead of opening the old one (which SessionManager.open
	 * would turn into a new, empty session).
	 */
	async archive(threadId: string, archived: boolean): Promise<void> {
		const live = this.threads.get(threadId);
		if (live?.busy) throw new AppServerError("turnInProgress", "interrupt the turn first");
		let wasLoaded = false;
		await this.transition(threadId, async (thread) => {
			wasLoaded = thread !== undefined;
			if (thread) await thread.dispose();
			const file = await this.files.find(threadId);
			if (!file) throw new AppServerError("threadNotFound", `no saved thread: ${threadId}`);
			if (isArchivedPath(file) === archived) return;
			const target = archived ? join(dirname(file), ARCHIVE_DIR) : dirname(dirname(file));
			await mkdir(target, { recursive: true });
			const moved = join(target, basename(file));
			await moveSessionFileWithoutReplace(file, moved, threadId, () => this.files.remember(threadId, moved));
		});
		if (wasLoaded) this.ctx.broadcast("thread/status/changed", { threadId, status: "notLoaded" });
		this.ctx.broadcast("thread/archived", { threadId, archived });
	}

	fork(threadId: string, atItemId: string | undefined, by: Subscriber): Promise<Thread> {
		// Tracked from its first step, the source lookup, so closeAll waits for it (§5.6).
		return this.track(async () => {
			const live = this.threads.get(threadId);
			const source = live?.file ?? (await this.files.find(threadId));
			if (!source || !existsSync(source)) throw new AppServerError("threadNotFound", `nothing to fork: ${threadId}`);
			this.assertOpen();
			const { entries, manager } = this.branchOf(source);
			const cwd = live?.session.sessionManager.getCwd() ?? manager.getHeader()?.cwd ?? process.cwd();
			// Resolve the item on the source's active branch first, so an unknown item creates nothing.
			const leafId = atItemId === undefined ? undefined : entryForItem(entries, atItemId);
			if (atItemId !== undefined && leafId === undefined) {
				throw new AppServerError("invalidParams", `no item ${atItemId} in ${threadId}`);
			}
			// One file, never a full copy to delete afterwards: forkFrom writes only the path to leafId, locked
			// before it exists, and reads the source without locking or writing it (Task 2).
			const sessionManager = SessionManager.forkFrom(source, cwd, liveDirFor(this.ctx, cwd), leafId === undefined ? undefined : { leafId });
			const thread = await this.load(sessionManager, by.mode, "fork", live?.approvalMode ?? defaultApprovalMode(by.mode));
			this.subscribe(thread, by);
			const summary = thread.toThread();
			this.ctx.broadcast("thread/started", { thread: summary });
			return summary;
		});
	}
```

Services on `ThreadManager`: `readonly payloads: PayloadStore` (process-private spool, closed by `closeAll`) and `private readonly listingPages = new ListingPages();`. Import `pageHistory`, `type HistoryPage`, `PayloadStore`, `ListingPages`, `moveSessionFileWithoutReplace`, and protocol `ThreadSummary`. In this task add `readonly payloads: PayloadStore` to LoadedThread and a fifth constructor argument after `onActivityEnd`; pass `this.payloads` at every construction site. Declare an optional structural mapper slot here, `mapper?: { currentTurnId(): string | undefined; wireSnapshot(): WireTurn | undefined }`, so this task type-checks without importing Task 11's not-yet-created file. Task 11 replaces that declaration with `mapper!: ItemMapper` when attaching the concrete implementation. After closing threads, `closeAll` clears listing snapshots and awaits `payloads.close()`. Add the `payload/read` handler as `(params) => this.payloads.read(params)`; the store tracks accepted reads so close waits or answers shuttingDown, never deletes a file under a read. Import `WireTurn` and `type SessionInfo` from `../core/session-manager.ts`. Confirm `SessionManager.list(cwd, dir)` filters by header cwd when `dir` is not the cwd's default directory (`session-manager.ts:1899-1914`) and `listAll(dir)` reads one custom dir (`:1944-1946`).

Extend `handlers()`:

```ts
			"thread/list": (params) => this.list(params),
			"thread/read": ({ threadId, cursor }) => this.read(threadId, cursor),
			"thread/fork": ({ threadId, atItemId }, connection) => this.fork(threadId, atItemId, connection).then((thread) => ({ thread })),
			"thread/archive": ({ threadId }) => this.archive(threadId, true).then(() => ({})),
			"thread/unarchive": ({ threadId }) => this.archive(threadId, false).then(() => ({})),
			"thread/name/set": ({ threadId, name }, connection) =>
				this.withThread(threadId, connection.mode, async (thread) => {
					thread.session.setSessionName(name);
					return {};
				}),
```

- [ ] **Step 4a: Implement bounded history, listing snapshots and payload retrieval**

**New files (under packages/cli):** `src/app-server/history-pages.ts`, `listing-pages.ts`, `payloads.ts`; tests `test/app-server/history-pages.test.ts`, `listing-pages.test.ts`, `payloads.test.ts`. Include these and modified `client.ts`, `loaded-thread.ts`, `harness.ts`, `session-files.ts` in this task's explicit staging commands.

`history-pages.ts`: `type HistoryPage = Pick<ResultOf<"thread/read">, "turns" | "runningTurn" | "nextCursor">`; `pageHistory(input: { thread: Thread | ThreadSummary; entries: readonly SessionEntry[]; cursor?: string; runningTurn?: WireTurn }, payloads: PayloadStore): HistoryPage`. Constants: `MAX_HISTORY_TURNS = 50`, `MAX_HISTORY_RESPONSE_BYTES = 1_048_576`, `HISTORY_ENVELOPE_RESERVE_BYTES = 1024`. Task 1 caps string envelope ids at 128 code points; reserve 1024 bytes for the id/envelope, including worst-case JSON escaping, when counting the result. Cursor: validated base64url JSON `{version: 1, threadId, branchTipId, beforeTurnId, excludedActiveTurnId?}`. Anchor at the initial read's last entry; continue from the oldest returned turn id, not an offset. Locate that tip in the current active branch, read only its prefix, and validate thread/before-turn ids. Malformed, foreign or diverged anchors answer `invalidCursor`; limit cursor length to 4096 bytes. An empty branch has no continuation. Exclude the initially active turn from history. The separate `runningTurn` is the mapper's CURRENT complete snapshot, even with an older cursor. Convert through `payloads.turn`; take newest pages by count and serialized byte budget, returning each chronologically. Count the complete response/envelope and separate snapshot. Reference an oversized turn so every page progresses. Freeze/validate before subscribing in the synchronous resume commit.

`ListingPages.page(params: ParamsOf<"thread/list">, scan: () => Promise<ThreadSummary[]>): Promise<ResultOf<"thread/list">>` caches an immutable sorted summary scan. At most 50 summaries and 1 MiB per response, advancing by the actual count. Opaque cursor binds snapshot id, next index, normalized cwd/archived filters. Keep at most 32 snapshots, 5-minute sliding expiry and LRU eviction. Continuations invoke no scan. Expiry/eviction/filter mismatch answers `invalidCursor`; initial calls explicitly retain full `SessionManager.list/listAll` transcript parsing cost. This is not a metadata index. Bound `titleOf` to 200 Unicode code points for sidebar responses. Clear snapshots at shutdown.

`PayloadStore`: `constructor(agentDir: string)` (private pid/token spool directory), `summary(turn: Turn): TurnSummary`, `item(item: Item): WireItem`, `turn(turn: Turn): WireTurn`, `output(output: ToolOutput[]): ToolOutput[] | PayloadRef`, `input(input: unknown): {input: unknown} | {inputRef: PayloadRef}`, `read(params: ParamsOf<"payload/read">): Promise<ResultOf<"payload/read">>`, `close(): Promise<void>`. Inline limit 65,536 UTF-8 JSON bytes; copy small values before enqueueing. Spool larger immutable JSON incrementally to process-private temp files with unguessable issued ids indexed internally, never paths. Freeze immutable segments/metadata synchronously, issue the reference, and spool asynchronously in bounded chunks. A read awaits spool completion and reports failure as an actionable internal error, never partial JSON. Close waits for/cancels spools before removing its directory. Do not first stringify/clone an arbitrarily large base64 value into another unbounded buffer. `summary` copies id/threadId/status and caps error previews at 2,000 code points with a bounded iterator, not Array.from of the full string; `turn` uses it for reference headers. Retain full errors inside the payload. Read at most 49,152 raw bytes as base64, `nextOffset` unless EOF. Reject out-of-range offsets/maxBytes and unknown/expired ids. Lease files for 30 minutes, renewing on read; remove on expiry/close. Keep only small index metadata in memory. Startup cleanup confirms an orphan directory's owner has exited; never delete another server's files. Temporary payload writes are allowed; `thread/read` never writes the transcript. Register the `payload/read` handler here.

Client: add `readPayload(ref: PayloadRef): Promise<unknown>`, `resolveTurn(value: WireTurn): Promise<Turn>`, `resolveItem(value: WireItem): Promise<Item>`. Concatenate decoded bytes before UTF-8 decoding; validate parsed payloads against Turn/Item schemas and reference ids/types/status. Chunk responses must continue dispatching while a client buffers thread notifications for a referenced resume snapshot. Add `TestClient.readTurns(threadId: string, cursor?: string): Promise<Turn[]>` to the harness for tests inspecting items: request `thread/read`, resolve that historical page's WireTurns (not its separate active snapshot). Use it in Tasks 11/12; large tests must inspect raw references too.

Write failing tests for append-between-pages without duplicates/omissions; malformed/cross-thread/changed-branch cursors; immutable listing continuation under new/name/archive changes; filter mismatch/expiry/eviction; 50 image-bearing turns and one item/turn over 64 MiB. Assert responses ≤1 MiB, progress on a referenced single turn, lossless multibyte chunk reconstruction, invalid ids/offsets, cleanup and bounded metadata. Run over both transports. Old-page resume during streaming reconstructs its separate current snapshot plus buffered later deltas exactly once; invalid resume leaves subscribers unchanged.

- [ ] **Step 4b: Implement destination-safe archive publication**

`session-files.ts`: `moveSessionFileWithoutReplace(source: string, destination: string, expectedId: string, onPublished: () => void): Promise<void>`. Refuse symlink sources and existing destinations with structured `archiveConflict`. Canonicalize both paths after creating the destination directory; acquire both locks in sorted path order and release partial acquisitions on failure. Map `SessionLockedError` to `threadLockedElsewhere`. Under both locks, recheck the source header and destination absence. Publish by same-filesystem `link(source, destination)` (fails on EEXIST), `unlink(source)`, then `onPublished`, retaining both locks through index update. Never fall back to replacing rename. If unlink fails, remove only this operation's destination after verifying it still links the unchanged source inode; report failed rollback with paths/instructions. After source unlink succeeds, index-update failure must not delete the sole surviving transcript: report the new path for header-based recovery. A crash may leave duplicate hard links: report and require resolution, never silently delete one.

Test archive/unarchive with colliding imported basenames, a real child holding the destination, creation between check/publication, gated publication/index update proving both locks held, unlink failure and rollback failure. Refusal preserves both original files byte-for-byte and releases acquired locks. Success leaves one link and no lock. Inject failures via test mocks, not production-only gates.

- [ ] **Step 5: Add thread-method tests**

Append to `threads.test.ts`, using Task 9's `savedThread` helper:

```ts
test("thread/read on a saved thread writes nothing and returns its turns", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	// No final newline: a reader that repaired it would change the file.
	const before = readFileSync(file, "utf8").replace(/\n$/, "");
	writeFileSync(file, before);
	const a = await connect();
	const read = await a.client.request("thread/read", { threadId: id });
	expect(read.thread.status).toBe("notLoaded");
	expect(read.turns).toHaveLength(1);
	expect(readFileSync(file, "utf8")).toBe(before);
});

test("thread/read works while another process holds the thread", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const holder = spawn(process.execPath, [join(import.meta.dirname, "fixtures/hold-session.ts"), file], {
		stdio: ["pipe", "pipe", "inherit"],
	});
	try {
		await waitForLine(holder.stdout!, "locked");
		const a = await connect();
		expect((await a.client.request("thread/read", { threadId: id })).turns).toHaveLength(1);
	} finally {
		holder.stdin!.end();
		await once(holder, "exit");
	}
});

test("archive moves a thread out of the default list and unarchive brings it back", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/archive", { threadId: id });
	expect((await a.client.request("thread/list", { cwd })).threads.map((t) => t.id)).not.toContain(id);
	expect((await a.client.request("thread/list", { cwd, archived: true })).threads.map((t) => t.id)).toContain(id);
	await a.client.request("thread/unarchive", { threadId: id });
	expect((await a.client.request("thread/list", { cwd })).threads.map((t) => t.id)).toContain(id);
});

test("archiving a loaded thread unloads it, moves the file, and a resume then loads the archived file", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/resume", { threadId: id });
	await a.client.request("thread/archive", { threadId: id });
	expect(threads.loadedCount()).toBe(0);
	expect(existsSync(file)).toBe(false);
	const { thread } = await a.client.request("thread/resume", { threadId: id });
	expect(thread.archived).toBe(true);
	await a.client.request("thread/unarchive", { threadId: id });
	expect(existsSync(file)).toBe(true);
	expect((await a.client.request("thread/resume", { threadId: id })).thread.archived).toBe(false);
});

test("archiving an unloaded thread, then resuming it, loads the archived file", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	await a.client.request("thread/archive", { threadId: id });
	const { thread } = await a.client.request("thread/resume", { threadId: id });
	expect(thread.archived).toBe(true);
	expect(threads.loadedCount()).toBe(1);
});

test("an archive that arrives while a resume is loading waits for it, closes it, then moves the file", async () => {
	const gate = createGate();
	const { cwd, sessionDir, threads, connect } = await startServer({ extraExtensions: [{ name: "gate", factory: gate.extension }] });
	const { id, file } = savedThread(cwd, sessionDir);
	const a = await connect();
	const resuming = a.client.request("thread/resume", { threadId: id }).then(
		(result) => result.thread.id,
		(error: unknown) => (error as { code?: string }).code,
	);
	// The resume holds an open manager on `file` and is parked in an extension factory.
	await gate.entered;
	// Called directly so the transition reserves the id in this same step, before the gate opens.
	const archiving = threads.archive(id, true);
	gate.open();
	await archiving;
	// The resume either answered before the archive closed its thread, or found it closed.
	expect([id, "threadNotFound"]).toContain(await resuming);
	expect(gate.events).toEqual(["session_shutdown"]);
	expect(threads.loadedCount()).toBe(0);
	expect(existsSync(file)).toBe(false);
	const moved = join(sessionDir, ARCHIVE_DIR, basename(file));
	expect(existsSync(moved)).toBe(true);
	expect(isLocked(file)).toBe(false);
	expect(isLocked(moved)).toBe(false);
});

test("a resume racing an archive loads the archived file once and creates nothing at the old path", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const a = await connect();
	const archiving = a.client.request("thread/archive", { threadId: id });
	const resuming = a.client.request("thread/resume", { threadId: id });
	await Promise.all([archiving, resuming]);
	expect(existsSync(file)).toBe(false);
	expect(threads.get(id).file).toContain("archived");
});

test("thread/fork at an unknown item creates no file", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const { id } = savedThread(cwd, sessionDir);
	const before = readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"));
	const a = await connect();
	await expect(a.client.request("thread/fork", { threadId: id, atItemId: "missing" })).rejects.toMatchObject({
		code: "invalidParams",
	});
	expect(readdirSync(sessionDir).filter((name) => name.endsWith(".jsonl"))).toEqual(before);
});

test("a transcript left with two names by an interrupted archive is reported with both paths, and nothing changes", async () => {
	const { cwd, sessionDir, threads, connect } = await startServer();
	const { id, file } = savedThread(cwd, sessionDir);
	const content = readFileSync(file, "utf8");
	// The crash window of §5.8: link() to the archive succeeded, unlink() of the source never ran.
	mkdirSync(join(sessionDir, ARCHIVE_DIR), { recursive: true });
	const second = join(sessionDir, ARCHIVE_DIR, basename(file));
	linkSync(file, second);
	const a = await connect();
	const error = await a.client.request("thread/resume", { threadId: id }).catch((e: unknown) => e);
	expect(error).toMatchObject({ code: "archiveConflict", data: { reason: "duplicateLinks" } });
	expect(new Set((error as { data: { paths: string[] } }).data.paths)).toEqual(new Set([file, second]));
	expect(threads.loadedCount()).toBe(0);
	expect(readFileSync(file, "utf8")).toBe(content);
	expect(isLocked(file)).toBe(false);
});

test("a resume of a fork whose load is still running joins that load", async () => {
	const gate = createGate();
	const started: string[] = [];
	const counter = (knightcode: ExtensionAPI) =>
		knightcode.on("session_start", (_event, ctx) => {
			started.push(ctx.sessionManager.getSessionId());
		});
	const { cwd, sessionDir, threads, connect } = await startServer({
		extraExtensions: [
			{ name: "gate", factory: gate.extension },
			{ name: "counter", factory: counter },
		],
	});
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	const b = await connect();
	// The source is not loaded, so the fork's load is the first, and it parks at the gate with its file written.
	const forking = a.client.request("thread/fork", { threadId: id });
	await gate.entered;
	const listed = await a.client.request("thread/list", { cwd });
	const forkId = listed.threads.map((t) => t.id).find((t) => t !== id)!;
	const resuming = b.client.request("thread/resume", { threadId: forkId });
	gate.open();
	const [{ thread }] = await Promise.all([forking, resuming]);
	expect(thread.id).toBe(forkId);
	expect(started.filter((s) => s === forkId)).toHaveLength(1);
	expect(threads.loadedCount()).toBe(1);
	expect(threads.get(forkId).subscribers.size).toBe(2);
});

test("an archive of a fork whose load is still running waits for it", async () => {
	const gate = createGate();
	const { cwd, sessionDir, threads, connect } = await startServer({ extraExtensions: [{ name: "gate", factory: gate.extension }] });
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	const forking = a.client.request("thread/fork", { threadId: id }).catch((error: unknown) => error);
	await gate.entered;
	const forkId = (await a.client.request("thread/list", { cwd })).threads.map((t) => t.id).find((t) => t !== id)!;
	const forkFile = (await threads.files.find(forkId))!;
	// Called directly so the transition reserves the id before the gate opens.
	const archiving = threads.archive(forkId, true);
	gate.open();
	await archiving;
	await forking;
	expect(threads.loadedCount()).toBe(0);
	expect(existsSync(forkFile)).toBe(false);
	expect(existsSync(join(sessionDir, ARCHIVE_DIR, basename(forkFile)))).toBe(true);
	expect(isLocked(forkFile)).toBe(false);
});

test("shutdown waits for a thread/fork whose load is parked in an extension", async () => {
	const gate = createGate();
	const { cwd, sessionDir, threads, connect } = await startServer({ extraExtensions: [{ name: "gate", factory: gate.extension }] });
	const { id } = savedThread(cwd, sessionDir);
	const a = await connect();
	// The source is not loaded, so the fork's own load is the only one, and it parks at the gate.
	const forking = a.client.request("thread/fork", { threadId: id }).catch((error: unknown) => error);
	await gate.entered;
	const closing = threads.closeAll().then(() => gate.events.push("closeAll"));
	gate.open();
	await closing;
	expect(gate.events).toEqual(["session_shutdown", "closeAll"]);
	expect(await forking).toMatchObject({ code: "shuttingDown" });
	expect(threads.loadedCount()).toBe(0);
});

test("thread/list with a shared session dir filters by cwd, and a renamed file is found by its header id", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const other = mkdtempSync(join(tmpdir(), "knightcode-as-other-"));
	const mine = savedThread(cwd, sessionDir);
	savedThread(other, sessionDir);
	const a = await connect();
	expect((await a.client.request("thread/list", { cwd })).threads.map((t) => t.id)).toEqual([mine.id]);
	renameSync(mine.file, join(sessionDir, "imported.jsonl"));
	expect((await a.client.request("thread/read", { threadId: mine.id })).turns).toHaveLength(1);
	rmSync(other, { recursive: true, force: true });
});

test("thread/resume pages turns and says where the next page starts", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const manager = SessionManager.create(cwd, sessionDir);
	for (let i = 0; i < 51; i++) {
		manager.appendCustomEntry(TURN_MARKER_TYPE);
		manager.appendMessage({ role: "user", content: [{ type: "text", text: `turn ${i}` }], timestamp: i });
		manager.appendCustomEntry(TURN_END_TYPE, { status: "completed" });
	}
	const id = manager.getSessionId();
	manager.close();
	const a = await connect();
	const first = await a.client.request("thread/resume", { threadId: id });
	expect(first.turns).toHaveLength(50);
	expect(first.nextCursor).toEqual(expect.any(String));
	expect(first.nextCursor).not.toBe("50");
	const rest = await a.client.request("thread/read", { threadId: id, cursor: first.nextCursor });
	expect(rest.turns).toHaveLength(1);
	expect(rest.nextCursor).toBeUndefined();
});
```

Add to the test file's imports: `existsSync`, `linkSync`, `mkdirSync`, `mkdtempSync`, `readdirSync`, `readFileSync`, `renameSync`, `rmSync` from `node:fs`; `tmpdir` from `node:os`; `basename` beside `join` from `node:path`; `ARCHIVE_DIR` from `../../src/app-server/session-files.ts`; `TURN_END_TYPE`, `TURN_MARKER_TYPE` from `../../src/extensions/turn-marker.ts`; `type ExtensionAPI` from `../../src/index.ts`.

The two fork-race tests find the fork's id through `thread/list` while its load is parked: `forkFrom` has written the file, and the listing reads it. That is the window in which a resume used to open a second session and an archive used to move the file under a running load; `load()` now registers every build in `loading` by id.

In the archive-during-load test, `thread/resume` reaches the server through the in-process transport, and `gate.entered` proves it is inside the load; `threads.archive` is then called directly so the reservation happens before `gate.open()`, with no sleep in between. Whichever of the resume's answer and the archive's dispose comes first, the invariants hold: one session, disposed once (`events`), no lock left, and the file only at its archived path.

The fork test needs turns; it is in Task 11.

- [ ] **Step 6: Run tests, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/transcript.test.ts test/app-server/threads.test.ts test/app-server/history-pages.test.ts test/app-server/listing-pages.test.ts test/app-server/payloads.test.ts`
Expected: PASS.

Run: `bun run check-types`

```bash
git add packages/cli/src/app-server/transcript.ts packages/cli/src/app-server/threads.ts packages/cli/src/app-server/loaded-thread.ts packages/cli/src/app-server/session-files.ts packages/cli/src/app-server/history-pages.ts packages/cli/src/app-server/listing-pages.ts packages/cli/src/app-server/payloads.ts packages/cli/src/app-server/client.ts packages/cli/test/app-server/harness.ts packages/cli/test/app-server/transcript.test.ts packages/cli/test/app-server/threads.test.ts packages/cli/test/app-server/history-pages.test.ts packages/cli/test/app-server/listing-pages.test.ts packages/cli/test/app-server/payloads.test.ts
git commit -m "feat(cli): read app server turns back from session files"
```

---

### Task 11: `ItemMapper` and the turn methods

**Files:**
- Create: `packages/cli/src/app-server/item-mapper.ts`, `packages/cli/src/app-server/start-request.ts`, `packages/cli/test/app-server/turns.test.ts`, `packages/cli/test/app-server/fixtures/virtual-model-extension.ts`, `packages/cli/test/suite/prompt-signal.test.ts`
- Modify: `packages/cli/src/app-server/threads.ts` (attach and restore the mapper in `load`; `liveTurns` uses its snapshot; handlers `turn/*`, `thread/compact`, `thread/settings/update`; `threadExtensions` gains the `model_select` bridge; a lost lock unloads the thread), `packages/cli/src/app-server/loaded-thread.ts` (`mapper` field), `packages/cli/src/core/agent-session.ts` (`PromptOptions.signal`: checked before a command runs, before a steer queues, after preflight's last await; passed through `sendUserMessage`), `packages/cli/src/core/extensions/runner.ts` (`createCommandContext` passes the signal on), `packages/cli/src/core/extensions/types.ts` (`SendUserMessageOptions.signal`)

**Interfaces:**
- Consumes: `transcript.ts` helpers (Task 10); `openMarkerOf`, `turnEndAt`, `turnEndOf`, `TURN_MARKER_TYPE`, `TURN_END_TYPE` (Task 5); `LoadedThread`, `ThreadManager` (Task 9).
- Produces: `class ItemMapper { constructor(thread: LoadedThread, broadcast: AppServerContext["broadcast"], onSettled: () => void); restore(turns: readonly Turn[]): void; handle(event: AgentSessionEvent): void; currentTurnId(): string | undefined; snapshot(): Turn | undefined; wireSnapshot(): WireTurn | undefined; settled(aborted: boolean, error?: unknown): void }`; `StartRequest` in `start-request.ts` (mutable cancellation owner, request token, first disposition); `ThreadManager.startTurn(...): Promise<TurnStartResult>`, `.queue`, `.interrupt`; `PromptOptions.signal?: AbortSignal` in `agent-session.ts`; `SendUserMessageOptions.signal?: AbortSignal` in `extensions/types.ts`; `ExtensionRunner.createCommandContext(preflightResult?, signal?)`.

The mapper follows §4.2 and §4.3, with eight rules that keep live and read-back identical:

1. A turn opens at the run's first `agent_start` only; a later `agent_start` while a turn is open (retry, follow-up, overflow recovery) changes nothing.
2. The turn id is the run's marker, found by walking back from the leaf (`openMarkerOf`), not assumed to be the leaf. If the built-in did not write one, the mapper appends it, and the end entry at settle.
3. Assistant messages are counted at `message_end`, as `readTurns` counts entries. While one streams, its deltas use the ordinal it will get.
4. `turn/completed` takes its status from the end entry (`turnEndAt`), which the built-in wrote just before (extension handlers run before subscribers), or the mapper writes with the same `turnEndOf`.
5. Tool call items start at their assistant message's `message_end`, in block order, with status `pending`, whether or not they ever run. A call still unfinished when the turn settles completes as `failed`, as readTurns reads a call without a result. Nested calls are the only items created at execution start.
6. Order is explicit. Every `item/started` and `item/completed` of a top-level item carries `index`, its position among the turn's top-level items, which is its position in `readTurns`' `items`. Arrival order is not enough. For content `[toolCall, text]`, text streams first and the call starts at `message_end`, so a client that appended in arrival order would show text, then call, while the file holds call, then text (a probe confirmed this with the previous mapper). A streaming text or thinking item gets a provisional index; at `message_end` the mapper walks the finalized blocks in order and completes every item of the message with its final index, so the client moves the text after the call. Indexes of earlier messages never change.
7. The finalized message decides. `message_end` handlers may replace a message, and the session saves the replacement (`agent-session.ts:1347-1365` replaces it in place before subscribers see `message_end`). So text comes from the assistant message's `message_end`, and a tool call completes from its tool result's `message_end`, never from `tool_execution_end`, whose result a handler can still replace. A streamed block that is gone or changed kind is removed BEFORE finalized replacements start/complete: the ordinal id may be reused. No late removal may delete that replacement.
8. Between runs, an idle compaction or extension message belongs to the last turn and continues its ordinals and indexes. After a load the mapper has seen no turn, so `restore` seeds them from the turns read back from the file.

The mapper also keeps the running turn's items with their text so far, for `thread/resume` and `thread/read` on a running thread (§4.5), and sends copies: the in-process transport passes objects, and the mapper keeps mutating its own.

Preflight cancellation (§5.6) is the other half of this task. A probe of the previous design found two gaps: the abort controller was created after the asynchronous auth check, so an interrupt during that check cancelled nothing; and extension commands ran before the only signal check, while a command such as `/plan <task>` dispatches its task through `ctx.sendUserMessage()`, which carried no signal. So the controller now exists from before the start queues, is re-checked after the auth await, and reaches commands and the prompts they dispatch the same way the acceptance hook `preflightResult` already does.

- [ ] **Step 1: Write the virtual-model fixture and the failing tests**

`packages/cli/test/app-server/fixtures/virtual-model-extension.ts`:

```ts
import type { ExtensionAPI } from "../../../src/index.ts";

/** Session ids the router saw, in order. Module state on purpose: shared by every thread in the process. */
export const routedFrom: string[] = [];

/** A virtual model that routes to `target()` and records which session's context it ran with. */
export function virtualModelExtension(target: () => { provider: string; id: string }) {
	return (knightcode: ExtensionAPI): void => {
		knightcode.registerVirtualModel({
			provider: "virt",
			id: "auto",
			name: "Auto",
			route: (_request, ctx) => {
				routedFrom.push(ctx.sessionManager.getSessionId());
				const { provider, id } = target();
				return { model: ctx.modelRegistry.find(provider, id)!, thinkingLevel: "off" };
			},
		});
	};
}
```

`ExtensionVirtualModel` (`core/extensions/types.ts:1903`) is `VirtualModelDefinition` with `route(request, ctx)`; the route returns a `ModelRoute` whose `model` is a catalog `Model<Api>`, so the fixture looks the target up through `ctx.modelRegistry.find` (`model-registry.ts:73`). `ctx.sessionManager` is a `ReadonlySessionManager`, which has `getSessionId`.

`packages/cli/test/app-server/turns.test.ts`:

```ts
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@knightcode/ai";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI } from "../../src/index.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { TURN_MARKER_TYPE } from "../../src/extensions/turn-marker.ts";
import { routedFrom, virtualModelExtension } from "./fixtures/virtual-model-extension.ts";
import { cleanupServers, startServer, type TestClient } from "./harness.ts";

afterEach(async () => {
	vi.restoreAllMocks();
	await cleanupServers();
});

type Note = TestClient["notifications"][number];
type LiveItem = { id: string; type: string; tool?: string; text?: string; status?: string; parentItemId?: string; output?: unknown };
const itemOf = (n: Note) => n.params.item as LiveItem;
const isItemEvent = (n: Note) => n.method === "item/started" || n.method === "item/completed";
const turnsCompleted = (c: TestClient) => c.notifications.filter((n) => n.method === "turn/completed");

/**
 * Item order as a client builds it (§4.2): each top-level item at the latest `index` it was given, turn by
 * turn in turn/started order, removed items dropped. Nested calls are live-only and carry no index.
 */
function clientOrder(c: TestClient): string[] {
	const turns = c.notifications.filter((n) => n.method === "turn/started").map((n) => (n.params.turn as { id: string }).id);
	const position = new Map<string, [number, number]>();
	for (const n of c.notifications) {
		if (isItemEvent(n) && !itemOf(n).parentItemId) {
			position.set(itemOf(n).id, [turns.indexOf(n.params.turnId as string), n.params.index as number]);
		}
		if (n.method === "item/removed") position.delete(n.params.itemId as string);
	}
	return [...position].sort(([, a], [, b]) => a[0] - b[0] || a[1] - b[1]).map(([id]) => id);
}

/** The last item/completed of each top-level item: what a client shows once the turn ends. */
function completedItems(c: TestClient): Map<string, LiveItem> {
	const items = new Map<string, LiveItem>();
	for (const n of c.notifications) {
		if (n.method === "item/completed" && !itemOf(n).parentItemId) items.set(itemOf(n).id, itemOf(n));
		if (n.method === "item/removed") items.delete(n.params.itemId as string);
	}
	return items;
}

/** Live order, ids, contents, tool statuses and outputs, and turn statuses, then the same thread read back; they must agree. */
async function expectReadBackMatches(c: TestClient, threadId: string): Promise<void> {
	const turns = await c.readTurns(threadId);
	const items = turns.flatMap((t) => t.items);
	expect(clientOrder(c)).toEqual(items.map((i) => i.id));
	const live = completedItems(c);
	expect(new Set(live.keys())).toEqual(new Set(items.map((i) => i.id)));
	for (const item of items) {
		const seen = live.get(item.id)!;
		if (item.type === "toolCall") {
			expect(seen.status).toBe(item.status);
			expect(seen.output).toEqual(item.output);
		}
		if (item.type === "agentMessage" || item.type === "reasoning") expect(seen.text).toBe(item.text);
	}
	const started = c.notifications.filter((n) => n.method === "turn/started").map((n) => (n.params.turn as { id: string }).id);
	expect(turns.map((t) => t.id)).toEqual(started);
	const statuses = turnsCompleted(c).map((n) => (n.params.turn as { status: string }).status);
	expect(turns.map((t) => t.status)).toEqual(statuses);
}

/** A promise and the function that resolves it: a gate a test opens, or a signal a hook gives. */
function signal(): { promise: Promise<void>; fire(): void } {
	let fire!: () => void;
	const promise = new Promise<void>((resolve) => (fire = resolve));
	return { promise, fire };
}

test("a turn emits its notifications in order and ends completed", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("hello there friend, how are you today")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	const done = await a.waitFor("turn/completed");
	expect((done.turn as { status: string }).status).toBe("completed");
	const sequence = a.notifications
		.filter((n) => n.method.startsWith("turn/") || n.method.startsWith("item/"))
		.map((n) => (n.method.startsWith("item/") && "item" in n.params ? `${n.method}:${itemOf(n).type}` : n.method));
	expect(sequence.slice(0, 4)).toEqual(["turn/started", "item/started:userMessage", "item/completed:userMessage", "item/started:agentMessage"]);
	expect(sequence.indexOf("item/agentMessage/delta")).toBe(4);
	expect(sequence.at(-2)).toBe("item/completed:agentMessage");
	expect(sequence.at(-1)).toBe("turn/completed");
	await expectReadBackMatches(a, thread.id);
});

test("live ids equal read-back ids: tool call, thinking, a second message, and a steer sent mid-turn", async () => {
	const { cwd, faux, connect } = await startServer({ tokensPerSecond: 40 });
	const a = await connect();
	writeFileSync(join(cwd, "a.txt"), "hello world\n");
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage(
			[fauxThinking("plan the edit carefully"), fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "world", newText: "there" }] })],
			{ stopReason: "toolUse" },
		),
		fauxAssistantMessage([fauxText("edited, and noted your steer")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "edit it" });
	await a.waitFor("turn/started");
	await a.client.request("turn/steer", { threadId: thread.id, text: "also keep it short" });
	await a.waitFor("turn/completed");
	const userItems = a.notifications.filter((n) => n.method === "item/completed" && itemOf(n).type === "userMessage");
	expect(userItems).toHaveLength(2);
	expect(turnsCompleted(a)).toHaveLength(1);
	const edited = a.notifications.find((n) => n.method === "item/completed" && itemOf(n).type === "toolCall");
	expect(edited?.params.item).toMatchObject({ fileChanges: [{ path: "a.txt", kind: "modify" }] });
	await expectReadBackMatches(a, thread.id);
});

test("a reply whose text follows its tool call is ordered call first, live and read back", async () => {
	const { cwd, faux, connect } = await startServer({ tokensPerSecond: 40 });
	const a = await connect();
	writeFileSync(join(cwd, "b.txt"), "b\n");
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("read", { path: "b.txt" }), fauxText("reading it now, then I will answer")], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "read b" });
	await a.waitFor("turn/completed");
	const turns = await a.readTurns(thread.id);
	expect(turns[0].items.map((i) => i.type)).toEqual(["userMessage", "toolCall", "agentMessage", "agentMessage"]);
	// The text streamed before the call existed; its final index moved it after the call.
	const text = turns[0].items[2];
	const indexes = a.notifications.filter((n) => isItemEvent(n) && itemOf(n).id === text.id).map((n) => n.params.index);
	expect(indexes.at(-1)).toBe(2);
	await expectReadBackMatches(a, thread.id);
});

test("a message_end handler that replaces a tool result changes the live completion to the saved result", async () => {
	const redact = (knightcode: ExtensionAPI) =>
		knightcode.on("message_end", (event) =>
			event.message.role === "toolResult"
				? { message: { ...event.message, content: [{ type: "text" as const, text: "[redacted]" }] } }
				: undefined,
		);
	const { cwd, faux, connect } = await startServer({ extraExtensions: [{ name: "redact", factory: redact }] });
	const a = await connect();
	writeFileSync(join(cwd, "b.txt"), "secret\n");
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("read", { path: "b.txt" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "read b" });
	await a.waitFor("turn/completed");
	const call = [...completedItems(a).values()].find((i) => i.type === "toolCall")!;
	expect(call.output).toEqual([{ type: "text", text: "[redacted]" }]);
	await expectReadBackMatches(a, thread.id);
});

test("an automatic retry and a follow-up stay inside one turn", async () => {
	const { cwd, faux, agentDir, connect } = await startServer({ tokensPerSecond: 40 });
	// The retry settings and retryable error text of test/suite/agent-session-retry-events.test.ts.
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } }));
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
		fauxAssistantMessage([fauxText("recovered after the retry")]),
		fauxAssistantMessage([fauxText("and the follow-up")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await a.client.request("turn/followUp", { threadId: thread.id, text: "then this" });
	await a.waitFor("turn/completed");
	expect(a.notifications.filter((n) => n.method === "turn/started")).toHaveLength(1);
	expect(a.notifications.some((n) => n.method === "turn/retry")).toBe(true);
	await expectReadBackMatches(a, thread.id);
});

test("ids still match with the turn-marker built-in disabled", async () => {
	const { cwd, faux, connect } = await startServer({ disabledBuiltinExtensions: ["turn-marker"] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("one")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	await expectReadBackMatches(a, thread.id);
});

test("ids still match when another extension appends an entry at agent_start", async () => {
	const appender = (knightcode: ExtensionAPI) => knightcode.on("agent_start", () => knightcode.appendEntry("other.marker"));
	const { cwd, faux, connect } = await startServer({ extraExtensions: [{ name: "appender", factory: appender }] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("one")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	await expectReadBackMatches(a, thread.id);
});

test("two concurrent turn/starts: one runs, the other answers turnInProgress; interrupt ends it interrupted", async () => {
	const { cwd, faux, connect } = await startServer({ tokensPerSecond: 20 });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("a".repeat(400))])]);
	const results = await Promise.allSettled([
		a.client.request("turn/start", { threadId: thread.id, text: "one" }),
		a.client.request("turn/start", { threadId: thread.id, text: "two" }),
	]);
	expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "turnInProgress" } });
	await a.client.request("turn/interrupt", { threadId: thread.id });
	const done = await a.waitFor("turn/completed");
	expect((done.turn as { status: string }).status).toBe("interrupted");
	await expectReadBackMatches(a, thread.id);
});

test("a marker without an end entry reads back interrupted (the process died mid-turn)", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const manager = SessionManager.create(cwd, sessionDir);
	manager.appendCustomEntry(TURN_MARKER_TYPE);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "go" }], timestamp: 1 });
	const id = manager.getSessionId();
	manager.close();
	const a = await connect();
	const { turns } = await a.client.request("thread/read", { threadId: id });
	expect(turns.map((t) => t.status)).toEqual(["interrupted"]);
});

test("thread/resume during a streaming reply returns the partial text, and the deltas that follow complete it", async () => {
	const { cwd, faux, connect } = await startServer({ tokensPerSecond: 30 });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	const final = "word ".repeat(60).trim();
	faux.setResponses([fauxAssistantMessage([fauxText(final)])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "talk" });
	await a.waitFor("item/agentMessage/delta");
	const b = await connect();
	const resumed = await b.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.runningTurn).toBeDefined();
	const running = await b.client.resolveTurn(resumed.runningTurn!);
	expect(resumed.turns.some((turn) => turn.id === running.id)).toBe(false);
	expect(running.status).toBe("inProgress");
	const partial = running.items.find((i) => i.type === "agentMessage") as { id: string; text: string };
	await b.waitFor("turn/completed");
	const after = b.notifications
		.filter((n) => n.method === "item/agentMessage/delta" && n.params.itemId === partial.id)
		.map((n) => n.params.delta as string)
		.join("");
	expect(partial.text + after).toBe(final);
});

test("two threads in two cwds run concurrently; turn and item notifications reach only their subscribers", async () => {
	const first = await startServer();
	const a = await first.connect();
	const b = await first.connect();
	const otherCwd = mkdtempSync(join(tmpdir(), "knightcode-as-cwd2-"));
	const { thread: ta } = await a.client.request("thread/start", { cwd: first.cwd });
	const { thread: tb } = await b.client.request("thread/start", { cwd: otherCwd });
	first.faux.setResponses([fauxAssistantMessage([fauxText("for a")]), fauxAssistantMessage([fauxText("for b")])]);
	await Promise.all([
		a.client.request("turn/start", { threadId: ta.id, text: "a" }),
		b.client.request("turn/start", { threadId: tb.id, text: "b" }),
	]);
	await Promise.all([a.waitFor("turn/completed"), b.waitFor("turn/completed")]);
	const threadIds = (c: TestClient) =>
		new Set(c.notifications.filter((n) => n.method.startsWith("item/")).map((n) => n.params.threadId));
	expect(threadIds(a)).toEqual(new Set([ta.id]));
	expect(threadIds(b)).toEqual(new Set([tb.id]));
	// Sidebar notifications reach everyone.
	expect(a.notifications.some((n) => n.method === "thread/status/changed" && n.params.threadId === tb.id)).toBe(true);
	rmSync(otherCwd, { recursive: true, force: true });
});

test("two threads using one extension's virtual model each route with their own session", async () => {
	let target = { provider: "", id: "" };
	const routed = await startServer({ extraExtensions: [{ name: "virt", factory: virtualModelExtension(() => target) }] });
	// Factories run when a thread loads, after this; the router reads the target per request.
	target = { provider: routed.faux.provider.id, id: routed.faux.getModel().id };
	const a = await routed.connect();
	const { thread: ta } = await a.client.request("thread/start", { cwd: routed.cwd, model: { provider: "virt", id: "auto" } });
	const { thread: tb } = await a.client.request("thread/start", { cwd: routed.cwd, model: { provider: "virt", id: "auto" } });
	routedFrom.length = 0;
	routed.faux.setResponses([fauxAssistantMessage([fauxText("a")]), fauxAssistantMessage([fauxText("b")]), fauxAssistantMessage([fauxText("a2")])]);
	await a.client.request("turn/start", { threadId: ta.id, text: "a" });
	await a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === ta.id);
	await a.client.request("turn/start", { threadId: tb.id, text: "b" });
	await a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === tb.id);
	await routed.threads.unload(tb.id);
	await a.client.request("turn/start", { threadId: ta.id, text: "a again" });
	await a.waitFor("turn/completed", () => turnsCompleted(a).length === 3);
	expect(routedFrom).toEqual([ta.id, tb.id, ta.id]);
});

test("calls in one reply keep block order, and an unexecuted call exists on both paths", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	writeFileSync(join(cwd, "b.txt"), "b\n");
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		// write then read in one reply; if the agent runs them in parallel, read finishes first.
		fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "a" }), fauxToolCall("read", { path: "b.txt" })], {
			stopReason: "toolUse",
		}),
		// A reply that fails while carrying a call: the call never runs.
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo never" })], { stopReason: "error", errorMessage: "boom" }),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await a.waitFor("turn/completed");
	await expectReadBackMatches(a, thread.id);
	const never = [...completedItems(a).values()].find((i) => i.tool === "bash");
	expect(never?.status).toBe("failed");
});

test("an idle compaction after unload and resume gets the same id and index live and read back", async () => {
	const { cwd, faux, threads, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("one")]), fauxAssistantMessage([fauxText("summary one")]), fauxAssistantMessage([fauxText("summary two")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	await a.client.request("thread/compact", { threadId: thread.id });
	await threads.unload(thread.id);
	const b = await connect();
	await b.client.request("thread/resume", { threadId: thread.id });
	await b.client.request("thread/compact", { threadId: thread.id });
	const live = await b.waitFor("item/completed", (p) => (p.item as { type: string }).type === "compaction");
	const turns = await b.readTurns(thread.id);
	const items = turns.at(-1)!.items;
	const compactions = items.filter((i) => i.type === "compaction").map((i) => i.id);
	expect(compactions).toHaveLength(2);
	expect((live.item as { id: string }).id).toBe(compactions[1]);
	expect(live.index).toBe(items.findIndex((i) => i.id === compactions[1]));
});

test("turn/interrupt while a start waits in an input hook stops it before it launches a run", async () => {
	const inHook = signal();
	const gate = signal();
	// An async input hook keeps the prompt in preflight while the session still reads idle.
	const holdInput = (knightcode: ExtensionAPI) =>
		knightcode.on("input", async () => {
			inHook.fire();
			await gate.promise;
			return { action: "continue" as const };
		});
	const { cwd, faux, threads, connect } = await startServer({ extraExtensions: [{ name: "hold", factory: holdInput }] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("should not run")])]);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await inHook.promise;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	gate.fire();
	expect(await starting).toMatchObject({ status: "cancelled", threadId: thread.id, requestId: expect.any(String) });
	expect(a.notifications.some((n) => n.method === "turn/started")).toBe(false);
	expect(threads.get(thread.id).session.isIdle).toBe(true);
	expect(faux.getPendingResponseCount()).toBe(1);
});

test("turn/interrupt during the auth check stops the start, whatever the check returns", async () => {
	const { cwd, faux, ctx, threads, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	const inCheck = signal();
	const gate = signal();
	// Stubbed: the faux provider is configured, so the real check never awaits. The stub awaits, and
	// then reports no auth, which would answer authRequired if the start were not cancelled.
	vi.spyOn(ctx.models, "hasConfiguredAuth").mockReturnValue(false);
	vi.spyOn(ctx.models, "checkAuth").mockImplementation(async () => {
		inCheck.fire();
		await gate.promise;
		return undefined;
	});
	faux.setResponses([fauxAssistantMessage([fauxText("should not run")])]);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await inCheck.promise;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	gate.fire();
	expect(await starting).toMatchObject({ status: "cancelled", threadId: thread.id, requestId: expect.any(String) });
	expect(a.notifications.some((n) => n.method === "turn/started")).toBe(false);
	expect(threads.get(thread.id).session.isIdle).toBe(true);
});

test("turn/interrupt while an extension command runs stops the prompt the command dispatches", async () => {
	const inCommand = signal();
	const gate = signal();
	// The shape of /plan <task>: a command that, after some work, dispatches its task as a prompt.
	const later = (knightcode: ExtensionAPI) =>
		knightcode.registerCommand("later", {
			description: "Dispatch a prompt after a wait",
			handler: async (_args, ctx) => {
				inCommand.fire();
				await gate.promise;
				await ctx.sendUserMessage("from the command");
			},
		});
	const { cwd, faux, threads, connect } = await startServer({ extraExtensions: [{ name: "later", factory: later }] });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("should not run")])]);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "/later" });
	await inCommand.promise;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	gate.fire();
	expect(await starting).toMatchObject({ status: "cancelled", threadId: thread.id, requestId: expect.any(String) });
	expect(a.notifications.some((n) => n.method === "turn/started")).toBe(false);
	expect(threads.get(thread.id).session.isIdle).toBe(true);
	expect(faux.getPendingResponseCount()).toBe(1);
});

test("thread/settings/update during a running turn applies without waiting for idle", async () => {
	const { cwd, faux, connect } = await startServer({ tokensPerSecond: 20 });
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("a".repeat(200))])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "slow" });
	const { thread: updated } = await a.client.request("thread/settings/update", { threadId: thread.id, thinkingLevel: "high" });
	expect(updated.thinkingLevel).toBe("high");
	expect(a.notifications.some((n) => n.method === "turn/completed")).toBe(false);
	await a.waitFor("turn/completed");
});

test("an extension streaming its session's virtual model directly routes with that session", async () => {
	let target = { provider: "", id: "" };
	const direct = (knightcode: ExtensionAPI) =>
		knightcode.registerCommand("direct", {
			description: "Stream the virtual model outside the agent loop",
			handler: async (_args, ctx) => {
				const model = ctx.modelRegistry.find("virt", "auto")!;
				await ctx.modelRegistry.streamSimple(model, { messages: [] }).result();
			},
		});
	const routed = await startServer({
		extraExtensions: [
			{ name: "virt", factory: virtualModelExtension(() => target) },
			{ name: "direct", factory: direct },
		],
	});
	target = { provider: routed.faux.provider.id, id: routed.faux.getModel().id };
	const a = await routed.connect();
	const { thread } = await a.client.request("thread/start", { cwd: routed.cwd });
	routedFrom.length = 0;
	routed.faux.setResponses([fauxAssistantMessage([fauxText("direct reply")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "/direct" });
	expect(routedFrom).toEqual([thread.id]);
});

test("a model change reaches the subscriber as thread/settings/updated", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	await a.client.request("thread/settings/update", { threadId: thread.id, model: { provider: faux.provider.id, id: faux.getModel().id } });
	await a.waitFor("thread/settings/updated");
});

test("thread/fork at an item copies the branch up to that item into a new thread", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("one")]), fauxAssistantMessage([fauxText("two")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "first" });
	await a.waitFor("turn/completed");
	await a.client.request("turn/start", { threadId: thread.id, text: "second" });
	await a.waitFor("turn/completed", () => turnsCompleted(a).length === 2);
	const turns = await a.readTurns(thread.id);
	const firstReply = turns[0].items.find((i) => i.type === "agentMessage")!;
	const { thread: forked } = await a.client.request("thread/fork", { threadId: thread.id, atItemId: firstReply.id });
	expect(forked.id).not.toBe(thread.id);
	const read = await a.client.request("thread/read", { threadId: forked.id });
	expect(read.turns).toHaveLength(1);
});
```

In the virtual-model test the assertion is what matters: `[A, B, A]`. The old shared route gives `[A, B, B]`, or fails after B unloads.

The names used are the real ones: `ctx.modelRegistry.find` and `.streamSimple` (`model-registry.ts:73,132`); the `input` event's result is `{ action: "continue" | "transform" | "handled" }` (`InputEventResult`, `types.ts:1165`); `registerCommand(name, { description, handler(args, ctx) })` (`types.ts:1548-1554, 1659`); a `message_end` handler returns `{ message }` with the same role (`MessageEndEventResult`, `types.ts:1470`); `getPendingResponseCount()` is on the faux handle `fauxProvider` returns (`providers/faux.ts:692-712`). The retry settings and the `overloaded_error` text are those of `test/suite/agent-session-retry-events.test.ts:34-46`. The compaction test needs a faux reply per summary; if `compact()` refuses a context this short, give the first turn a longer reply.

`packages/cli/test/suite/prompt-signal.test.ts`, the core half on the suite harness:

```ts
import { fauxAssistantMessage } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import type { ExtensionAPI } from "../../src/index.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;
afterEach(() => harness?.cleanup());

test("an aborted signal stops prompt() before a command runs", async () => {
	let ran = false;
	const command = (knightcode: ExtensionAPI) =>
		knightcode.registerCommand("noop", {
			description: "Records that it ran",
			handler: async () => {
				ran = true;
			},
		});
	harness = await createHarness({ extensionFactories: [command] });
	const controller = new AbortController();
	controller.abort();
	const dispositions: string[] = [];
	await harness.session.prompt("/noop", { signal: controller.signal, preflightResult: (d) => dispositions.push(d) });
	expect(ran).toBe(false);
	// The core reports a cancelled start as handled; the app server tells the two apart by its own signal.
	expect(dispositions).toEqual(["handled"]);
});

test("a command's ctx.sendUserMessage carries the outer signal into the prompt it starts", async () => {
	const controller = new AbortController();
	const command = (knightcode: ExtensionAPI) =>
		knightcode.registerCommand("dispatch", {
			description: "Aborts the outer signal, then dispatches a prompt",
			handler: async (_args, ctx) => {
				controller.abort();
				await ctx.sendUserMessage("nested");
			},
		});
	harness = await createHarness({ extensionFactories: [command] });
	harness.setResponses([fauxAssistantMessage("should not run")]);
	const dispositions: string[] = [];
	await harness.session.prompt("/dispatch", { signal: controller.signal, preflightResult: (d) => dispositions.push(d) });
	expect(dispositions).toEqual(["handled"]);
	expect(harness.getPendingResponseCount()).toBe(1);
	expect(harness.session.isIdle).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/cli && bun x vitest --run test/app-server/turns.test.ts test/suite/prompt-signal.test.ts`
Expected: FAIL: `turn/start` is `methodNotFound`, and `PromptOptions` has no `signal`.

- [ ] **Step 3: Implement `item-mapper.ts`**

```ts
/**
 * Session events to protocol notifications for one thread (§4.3). Ids, order and statuses follow
 * transcript.ts: every top-level item carries its index in the turn, and the finalized message, not the
 * stream, decides an item's final content and position (§4.2).
 */

import type { AssistantMessage } from "@knightcode/ai";
import type { Item, Turn, WireTurn } from "@knightcode/app-server-protocol";
import type { AgentSessionEvent } from "../core/agent-session.ts";
import { openMarkerOf, TURN_END_TYPE, TURN_MARKER_TYPE, type TurnEnd, turnEndAt, turnEndOf } from "../extensions/turn-marker.ts";
import type { AppServerContext } from "./context.ts";
import type { LoadedThread } from "./loaded-thread.ts";
import { fileChangesOf, outputOf, textOf, toolCallStatus } from "./transcript.ts";

type ToolCallItem = Extract<Item, { type: "toolCall" }>;
type TextItem = Extract<Item, { type: "agentMessage" | "reasoning" }>;
const copy = <T>(value: T): T => structuredClone(value);
const isNested = (item: Item) => item.type === "toolCall" && item.parentItemId !== undefined;

/** Per-turn ordinals and the next top-level index. Items between turns (idle compaction, an extension message) continue the last turn's. */
interface Counters {
	id: string;
	users: number;
	customs: number;
	compactions: number;
	assistants: number;
	/** Top-level items so far: the next item's index. */
	items: number;
}

const countersOf = (turn: Turn): Counters => ({
	id: turn.id,
	users: turn.items.filter((i) => i.type === "userMessage").length,
	customs: turn.items.filter((i) => i.type === "extensionMessage").length,
	compactions: turn.items.filter((i) => i.type === "compaction").length,
	// Unused after a turn ends: assistant messages only arrive inside a run.
	assistants: 0,
	items: turn.items.filter((i) => !isNested(i)).length,
});

/** The assistant message streaming now: where its items begin, and its text and thinking items by content index. */
interface Streaming {
	base: number;
	open: Map<number, TextItem>;
}

export class ItemMapper {
	private readonly thread: LoadedThread;
	private readonly broadcast: AppServerContext["broadcast"];
	private readonly onSettled: () => void;
	private turn: Turn | undefined;
	/** The running turn's counters, or the last turn's between runs (restored from the file on load). */
	private counters: Counters | undefined;
	private streaming: Streaming | undefined;
	private calls = new Map<string, ToolCallItem>();
	/** Top-level item id to its current index, for the snapshot's order. */
	private positions = new Map<string, number>();

	constructor(thread: LoadedThread, broadcast: AppServerContext["broadcast"], onSettled: () => void) {
		this.thread = thread;
		this.broadcast = broadcast;
		this.onSettled = onSettled;
	}

	/** Continue the last turn's ordinals and indexes for items that arrive before the next run (§4.2). Called once after load. */
	restore(turns: readonly Turn[]): void {
		const last = turns.at(-1);
		this.counters = last ? countersOf(last) : undefined;
	}

	currentTurnId(): string | undefined {
		return this.turn?.id;
	}

	/** The running turn with every item so far, including partial text, in index order (§4.5). */
	snapshot(): Turn | undefined {
		return this.turn && this.ordered(this.turn);
	}

	/** Freeze a bounded wire snapshot without cloning large text/media; PayloadStore captures immutable segments synchronously. */
	wireSnapshot(): WireTurn | undefined {
		if (!this.turn) return undefined;
		const key = (item: Item): number => item.type === "toolCall" && item.parentItemId !== undefined
			? (this.positions.get(item.parentItemId) ?? Number.MAX_SAFE_INTEGER) + 0.5
			: (this.positions.get(item.id) ?? Number.MAX_SAFE_INTEGER);
		const items = [...this.turn.items].sort((a, b) => key(a) - key(b));
		return this.thread.payloads.turn({ ...this.turn, items });
	}

	/** A raw copy for internal/small-test use only; never use this deep clone for a large wire snapshot. */
	private ordered(turn: Turn): Turn {
		const result = copy(turn);
		const key = (item: Item): number =>
			item.type === "toolCall" && item.parentItemId !== undefined
				? (this.positions.get(item.parentItemId) ?? Number.MAX_SAFE_INTEGER) + 0.5
				: (this.positions.get(item.id) ?? Number.MAX_SAFE_INTEGER);
		result.items.sort((a, b) => key(a) - key(b));
		return result;
	}

	private get manager() {
		return this.thread.session.sessionManager;
	}

	private notifyItem(method: "item/started" | "item/completed", item: Item, turnId: string, index: number | undefined): void {
		if (index !== undefined) this.positions.set(item.id, index);
		this.thread.notify(method, {
			threadId: this.thread.id,
			turnId,
			item: this.thread.payloads.item(item),
			...(index === undefined ? {} : { index }),
		});
	}

	private started(item: Item, index: number | undefined, turnId = this.turn?.id): void {
		if (!turnId) return;
		if (this.turn?.id === turnId) this.turn.items.push(item);
		this.notifyItem("item/started", item, turnId, index);
	}

	private completed(item: Item, index: number | undefined, turnId = this.turn?.id): void {
		if (turnId) this.notifyItem("item/completed", item, turnId, index);
	}

	private removed(item: Item): void {
		if (!this.turn) return;
		this.turn.items = this.turn.items.filter((i) => i !== item);
		this.positions.delete(item.id);
		this.thread.notify("item/removed", { threadId: this.thread.id, turnId: this.turn.id, itemId: item.id });
	}

	/** An item that is the turn's next top-level item: user, custom, compaction. */
	private appendWhole(item: Item, counters: Counters): void {
		const index = counters.items++;
		this.started(item, index, counters.id);
		this.completed(item, index, counters.id);
	}

	handle(event: AgentSessionEvent): void {
		const threadId = this.thread.id;
		switch (event.type) {
			case "agent_start": {
				// A retry, follow-up or overflow recovery starts the agent again inside the same turn (§4.2).
				if (this.turn) return;
				const marker = openMarkerOf(this.manager.getBranch());
				let id = marker?.id;
				if (!id) {
					// The built-in was disabled or failed; write the marker here so ids still agree.
					console.error(`app-server: no turn marker in thread ${threadId}; writing one`);
					id = this.manager.appendCustomEntry(TURN_MARKER_TYPE);
				}
				this.turn = { id, threadId, status: "inProgress", items: [] };
				this.counters = { id, users: 0, customs: 0, compactions: 0, assistants: 0, items: 0 };
				this.streaming = undefined;
				this.calls.clear();
				this.positions.clear();
				this.broadcast("thread/status/changed", { threadId, status: "active" });
				const requestId = this.thread.pendingTurnRequestId;
				this.thread.pendingTurnRequestId = undefined;
				this.thread.notify("turn/started", { turn: { ...this.turn, items: [] }, ...(requestId ? { requestId } : {}) });
				return;
			}
			case "message_start":
				if (event.message.role === "assistant" && this.turn && this.counters) {
					this.streaming = { base: this.counters.items, open: new Map() };
				}
				return;
			case "message_update": {
				if (!this.turn || !this.counters || !this.streaming) return;
				const inner = event.assistantMessageEvent;
				if (inner.type !== "text_delta" && inner.type !== "thinking_delta") return;
				const id = `${this.turn.id}:${this.counters.assistants}:${inner.contentIndex}`;
				let item = this.streaming.open.get(inner.contentIndex);
				if (!item) {
					item = inner.type === "text_delta" ? { type: "agentMessage", id, text: "" } : { type: "reasoning", id, text: "" };
					// Provisional: blocks that start later (a tool call) may come before it; message_end settles it.
					const index = this.streaming.base + this.streaming.open.size;
					this.streaming.open.set(inner.contentIndex, item);
					this.started(item, index);
				}
				item.text += inner.delta;
				this.thread.notify(inner.type === "text_delta" ? "item/agentMessage/delta" : "item/reasoning/delta", {
					threadId,
					turnId: this.turn.id,
					itemId: id,
					delta: inner.delta,
				});
				return;
			}
			case "message_end": {
				const message = event.message;
				const counters = this.counters;
				if (!counters) return;
				if (message.role === "custom") {
					// Inside a run or between runs: an idle extension message belongs to the last turn, as on read-back.
					this.appendWhole(
						{
							type: "extensionMessage",
							id: `${counters.id}:custom:${counters.customs++}`,
							extension: message.customType,
							text: textOf(message.content),
						},
						counters,
					);
					return;
				}
				if (!this.turn) return;
				if (message.role === "user") {
					const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
					this.appendWhole(
						{
							type: "userMessage",
							id: `${this.turn.id}:user:${counters.users++}`,
							text: textOf(content),
							images: content.flatMap((c) => (c.type === "image" ? [{ mimeType: c.mimeType, data: c.data }] : [])),
						},
						counters,
					);
				} else if (message.role === "assistant") {
					this.finishAssistant(message as AssistantMessage, counters);
				} else if (message.role === "toolResult") {
					// The saved result, after any message_end handler replaced it (§4.2): the call's outcome.
					const call = this.calls.get(message.toolCallId);
					if (!call || call.parentItemId) return;
					const content = message.content as Parameters<typeof outputOf>[0];
					call.status = toolCallStatus(message.isError, content);
					call.output = outputOf(content);
					const changes = fileChangesOf(call.tool, call.input, message.isError);
					if (changes.length > 0) call.fileChanges = changes;
					this.completed(call, this.positions.get(call.id));
				}
				return;
			}
			case "tool_execution_start": {
				const known = this.calls.get(event.toolCallId);
				if (known) {
					// Already an item since its assistant message ended; the snapshot shows it running.
					known.status = "running";
					return;
				}
				// A nested call (code mode): live only, no block of its own, no index (§4.2 table).
				const nested: ToolCallItem = {
					type: "toolCall",
					id: event.toolCallId,
					tool: event.toolName,
					input: event.args,
					status: "running",
					output: [],
					...(event.parentToolCallId ? { parentItemId: event.parentToolCallId } : {}),
				};
				this.calls.set(event.toolCallId, nested);
				this.started(nested, undefined);
				return;
			}
			case "tool_execution_update": {
				if (!this.turn) return;
				const content = (event.partialResult as { content?: unknown })?.content;
				this.thread.notify("item/toolCall/outputDelta", {
					threadId,
					turnId: this.turn.id,
					itemId: event.toolCallId,
					output: this.thread.payloads.output(Array.isArray(content) ? outputOf(content) : []),
				});
				return;
			}
			case "tool_execution_end": {
				// Only nested calls complete here; a top-level call completes from its saved result (message_end).
				const item = this.calls.get(event.toolCallId);
				if (!item?.parentItemId) return;
				const content = (event.result as { content?: unknown })?.content;
				const blocks = Array.isArray(content) ? content : [];
				item.status = toolCallStatus(event.isError, blocks);
				item.output = outputOf(blocks);
				this.completed(item, undefined);
				return;
			}
			case "compaction_start":
				if (!this.turn) this.broadcast("thread/status/changed", { threadId, status: "active" });
				return;
			case "compaction_end": {
				const counters = this.counters;
				const summary = (event as { result?: { summary?: string } }).result?.summary;
				if (counters && summary !== undefined) {
					this.appendWhole({ type: "compaction", id: `${counters.id}:compaction:${counters.compactions++}`, summary }, counters);
				}
				if (!this.turn) {
					this.broadcast("thread/status/changed", { threadId, status: "idle" });
					this.onSettled();
				}
				return;
			}
			case "auto_retry_start":
				if (this.turn) {
					this.thread.notify("turn/retry", {
						threadId,
						turnId: this.turn.id,
						attempt: event.attempt,
						maxAttempts: event.maxAttempts,
						delayMs: event.delayMs,
						error: event.errorMessage,
					});
				}
				return;
			case "queue_update":
				this.thread.notify("turn/queue/updated", { threadId, steering: [...event.steering], followUp: [...event.followUp] });
				return;
			case "session_info_changed":
				this.broadcast("thread/name/updated", { threadId, name: event.name ?? "" });
				return;
			case "thinking_level_changed":
				this.thread.notify("thread/settings/updated", { thread: this.thread.toThread() });
				return;
			case "agent_settled":
				this.settled(event.aborted);
				return;
			default:
				return;
		}
	}

	/**
	 * The finalized assistant message, in block order (§4.2): tool calls start here, text and thinking items
	 * complete with their final text, and every item of the message gets its final index. A streamed item whose
	 * block is gone, or became another kind, is removed. Counted here, as readTurns counts the entry appended now.
	 */
	private finishAssistant(message: AssistantMessage, counters: Counters): void {
		const turn = this.turn!;
		const n = counters.assistants++;
		const streaming = this.streaming ?? { base: counters.items, open: new Map<number, TextItem>() };
		this.streaming = undefined;
		// Withdraw obsolete ids before starting replacements at those same ordinal positions.
		for (const [blockIndex, item] of streaming.open) {
			const block = message.content[blockIndex];
			const finalizedType = block?.type === "text" ? "agentMessage" : block?.type === "thinking" ? "reasoning" : undefined;
			if (item.type === finalizedType) continue;
			this.removed(item);
			streaming.open.delete(blockIndex);
		}
		let index = streaming.base;
		message.content.forEach((block, blockIndex) => {
			if (block.type === "toolCall") {
				// Every call starts here, executed or not: the order readTurns gives (§4.2).
				const call: ToolCallItem = { type: "toolCall", id: block.id, tool: block.name, input: block.arguments, status: "pending", output: [] };
				this.calls.set(block.id, call);
				this.started(call, index++);
				return;
			}
			if (block.type !== "text" && block.type !== "thinking") return;
			const type = block.type === "text" ? "agentMessage" : "reasoning";
			const text = block.type === "text" ? block.text : block.thinking;
			let item = streaming.open.get(blockIndex);
			if (item?.type !== type) item = undefined;
			if (!item) {
				// A block that streamed no delta still exists on read-back; start it here.
				item = { type, id: `${turn.id}:${n}:${blockIndex}`, text };
				this.started(item, index);
			}
			item.text = text;
			this.completed(item, index++);
		});
		counters.items = index;
	}

	/**
	 * End the turn with the status of its end entry: the built-in wrote it just before (extension
	 * handlers run before subscribers), or it is written here with the same rule. Also the fallback
	 * when prompt() rejects after preflight without settling. Calls that never finished (an aborted
	 * reply's unexecuted calls, an interrupted execution) complete as failed, as readTurns reads a call
	 * without a result.
	 */
	settled(aborted: boolean, error?: unknown): void {
		const turn = this.turn;
		if (!turn) return;
		this.turn = undefined;
		this.streaming = undefined;
		for (const call of this.calls.values()) {
			if (call.status !== "pending" && call.status !== "running") continue;
			call.status = "failed";
			this.completed(call, call.parentItemId ? undefined : this.positions.get(call.id), turn.id);
		}
		let end: TurnEnd | undefined = turnEndAt(this.manager.getBranch());
		if (!end) {
			end =
				error !== undefined
					? { status: "failed", error: error instanceof Error ? error.message : String(error) }
					: turnEndOf(aborted, this.manager.getBranch());
			try {
				this.manager.appendCustomEntry(TURN_END_TYPE, end);
			} catch (writeError) {
				// A closed manager or a lost lock: the turn still ends for the client; read-back says interrupted.
				console.error(`app-server: could not record the end of turn ${turn.id}: ${String(writeError)}`);
			}
		}
		turn.status = end.status;
		if (end.error) turn.error = end.error;
		this.thread.notify("turn/completed", { turn: this.thread.payloads.summary(turn) });
		this.broadcast("thread/status/changed", { threadId: this.thread.id, status: "idle" });
		this.onSettled();
	}
}
```

Event shapes, from `agent-session.ts:180-230` and `@knightcode/agent`: `message_update.assistantMessageEvent` carries `type`, `contentIndex`, `delta`; `compaction_end` carries `result`; `tool_execution_*` carry `toolCallId`, `toolName`, `args`, `partialResult`, `result`, `isError`, and `parentToolCallId` for nested calls; `agent_settled` carries `aborted`. A tool result message is `{ role: "toolResult", toolCallId, content, isError }`. `appendCustomEntry` returns the entry id (`session-manager.ts:1284`).

- [ ] **Step 4: Carry the start signal through the core**

The signal follows the path `preflightResult` already takes, so a command and every prompt it dispatches through its `ctx` are covered.

`packages/cli/src/core/extensions/types.ts`, `SendUserMessageOptions` (`:326`):

```ts
export interface SendUserMessageOptions {
	deliverAs?: "steer" | "followUp";
	expandPromptTemplates?: boolean;
	/** Internal acceptance hook forwarded through command and replacement-session dispatch. */
	preflightResult?: (disposition: PromptDisposition) => void;
	/** Internal: the dispatching start's cancellation, forwarded the same way (app server §5.6). */
	signal?: AbortSignal;
}
```

`packages/cli/src/core/extensions/runner.ts`, `createCommandContext` (`:994-1020`) takes the signal and passes it wherever it passes `preflightResult`:

```ts
	createCommandContext(
		preflightResult?: (disposition: PromptDisposition) => void,
		signal?: AbortSignal,
	): ExtensionCommandContext {
		// (property-descriptor copy unchanged)
		context.sendUserMessage = (content, options) => {
			this.assertActive();
			return this.sendUserMessageFn(content, {
				...options,
				preflightResult: preflightResult ?? options?.preflightResult,
				signal: signal ?? options?.signal,
			});
		};
		const replacementOptions = <T extends { signal?: AbortSignal; withSession?: (ctx: ReplacedSessionContext) => Promise<void> }>(
			options: T,
		): T => {
			const withSession = options.withSession;
			if (!withSession) return { ...options, signal: signal ?? options.signal };
			return {
				...options,
				signal: signal ?? options.signal,
				withSession: async (ctx: ReplacedSessionContext) => {
					const dispatch = ctx.sendUserMessage;
					ctx.sendUserMessage = (content, opts) => dispatch(content, { ...opts, preflightResult, signal });
					await withSession(ctx);
				},
			};
		};
```

Add internal `signal?: AbortSignal` to new/fork/switch option shapes in `ExtensionCommandContext`, `ExtensionCommandContextActions` and runner action types. Wrap even without `withSession`; the app-server action uses the signal to find its initiating StartRequest. Terminal runtime forwarding still carries the signal without needing app-server ownership transfer. Leave the rest unchanged.

`packages/cli/src/core/agent-session.ts`:

- `PromptOptions` (`:315-326`) gains:

  ```ts
  	/** Aborted before the prompt launches anything: it ends as cancelled, starting nothing (app server §5.6). */
  	signal?: AbortSignal;
  ```

- Keep `PromptDisposition` unchanged (`"handled" | "queued" | "started"`). RPC mode's prompt response carries it (`modes/rpc/rpc-types.ts:118`, `rpc-client.ts:202-204`), and §12 excludes any change to RPC mode. The three signal-aborted branches below report `handled`, which is true from the core's view: nothing launched. The app server distinguishes a cancelled start from a handled command by its own signal: `startTurn` records `cancelled` when the disposition is `handled` and its controller is aborted (Step 5).
- `prompt()` passes it to the command path: `const handled = await this._tryExecuteExtensionCommand(text, preflightResult, options?.signal);`.
- `_tryExecuteExtensionCommand(text, preflightResult?, signal?)`: after `this._assertExtensionStartup();`, before building the context:

  ```ts
  		// A cancelled start runs no command (app server §5.6).
  		if (signal?.aborted) {
  			preflightResult?.("handled");
  			return true;
  		}
  ```

  and `const ctx = this._extensionRunner.createCommandContext(acknowledge, signal);`.
- In the streaming branch, after the `streamingBehavior` check and before `_queueFollowUp`/`_queueSteer`:

  ```ts
  			if (options?.signal?.aborted) {
  				preflightResult?.("handled");
  				return;
  			}
  ```

- After preflight's last await, `const normalized = await this._normalizePromptImages(currentImages);` (`:2122`), before anything builds the messages or consumes `_pendingNextTurnMessages`:

  ```ts
  		// Every await of preflight is behind us; nothing can start between this check and the run.
  		if (options?.signal?.aborted) {
  			preflightResult?.("handled");
  			return;
  		}
  ```

- `sendUserMessage` (`:2408-2439`) passes `signal: options?.signal` to `this.prompt(...)` beside `preflightResult`.

`knightcode.sendMessage(..., { triggerTurn: true })` is the extension API rather than the command's `ctx`, and is not tied to one dispatch; §5.6 states that limit. The terminal passes no signal, so nothing changes for it.

- [ ] **Step 5: Wire the mapper, turns and settings into `threads.ts`**

`LoadedThread` gains `mapper!: ItemMapper;`. In `build`, after `bind` and before `this.threads.set`:

```ts
			thread.mapper = new ItemMapper(thread, (method, params) => this.ctx.broadcast(method, params), () => this.afterSettle(thread));
			// An idle compaction or extension message right after a load continues the last turn's ordinals (§4.2).
			thread.mapper.restore(readTurns(thread.id, session.sessionManager.getBranch()));
			thread.unsubscribeSession = session.subscribe((event) => thread.mapper.handle(event));
```

`afterSettle` unloads a thread whose lock was lost (§5.5), and otherwise restarts the idle check:

```ts
	private afterSettle(thread: LoadedThread): void {
		if (thread.session.sessionManager.hasLostLock()) {
			for (const subscriber of thread.subscribers) {
				subscriber.notify("error", { threadId: thread.id, message: "Another KnightCode process took this thread's session file; it was closed here." });
			}
			void this.unload(thread.id);
			return;
		}
		this.scheduleIdle(thread);
	}
```

`liveTurns` (Task 10) now replaces the running turn with the mapper's copy:

```ts
	private liveTurns(thread: LoadedThread): Turn[] {
		const turns = readTurns(thread.id, thread.session.sessionManager.getBranch(), thread.mapper.currentTurnId());
		const running = thread.mapper.snapshot();
		if (!running) return turns;
		// The file has the running turn's finished entries; the mapper also has its partial text.
		if (turns.at(-1)?.id === running.id) turns[turns.length - 1] = running;
		else turns.push(running);
		return turns;
	}
```

`resume`/`read` pass `mapper.wireSnapshot()` SEPARATELY to Task 10's history service; do not page the combined `liveTurns` array. It is an internal full-view helper, never an unbounded wire response. Freeze the snapshot/reference and validate the cursor, then subscribe/send in one synchronous commit. For large snapshots use a streaming immutable-segment writer in PayloadStore rather than cloning all base64/text first.

`threadExtensions(holder)` gains the bridge:

```ts
	private threadExtensions(holder: { thread?: LoadedThread }): InlineExtension[] {
		return [
			{
				name: "app-server-bridge",
				hidden: true,
				factory: (knightcode) => {
					// No session event exists for a model change (§4.3); extensions see model_select.
					knightcode.on("model_select", () => {
						const thread = holder.thread;
						if (thread) thread.notify("thread/settings/updated", { thread: thread.toThread() });
					});
				},
			},
		];
	}
```

Turn methods, following the engine's `prompt` (`sessions.ts:531-561`), with preflight on the thread's queue (§5.6). The controller exists before the start queues; the auth await is re-checked; `prompt()` checks the rest:

```ts
	async startTurn(threadId: string, text: string, images: ImageRef[] | undefined, by: Subscriber, requestId?: string): Promise<TurnStartResult> {
		const thread = await this.ensureLoaded(threadId, by.mode);
		this.subscribe(thread, by);
		// Before the first await of preflight, including the wait in the queue: turn/interrupt and dispose
		// abort every start that has not launched (§5.6).
		const request = new StartRequest(thread, requestId);
		const start = request.controller;
		this.startsBySignal.set(start.signal, request);
		thread.pendingStarts.add(start);
		try {
			await thread.exclusive(async () => {
				if (start.signal.aborted) { request.record("cancelled"); return; }
				if (thread.reservedStart && thread.reservedStart !== start) throw new AppServerError("turnInProgress", "replacement preflight reserved this thread");
				const { session } = thread;
				// Inside the queue: a second turn/start waits for this preflight, then sees the run.
				if (!session.isIdle) throw new AppServerError("turnInProgress", "a turn or compaction is running");
				const model = session.model;
				if (!model) throw new AppServerError("authRequired", "no model selected; pick one with thread/settings/update");
				const authorized =
					this.ctx.models.hasConfiguredAuth(model.provider) || (await this.ctx.models.checkAuth(model.provider)) !== undefined;
				// An interrupt during the check wins over its outcome.
				if (start.signal.aborted) { request.record("cancelled"); return; }
				if (!authorized) throw new AppServerError("authRequired", `not signed in to ${model.provider}`);
				thread.lastTurnSubscriber = by;
				thread.pendingTurnRequestId = request.requestId;
				let accepted = false;
				await new Promise<void>((resolve, reject) => {
					session
						.prompt(text, {
							images: images?.map((image) => ({ type: "image" as const, ...image })),
							source: "rpc",
							signal: start.signal,
							preflightResult: (disposition) => {
								if (disposition === "queued") { reject(new AppServerError("turnInProgress", "start unexpectedly queued on a running target")); return; }
								// The core reports a start its signal stopped as handled (Step 4); the signal says which.
								request.record(disposition === "handled" && start.signal.aborted ? "cancelled" : disposition);
								accepted = request.disposition === "started";
								resolve();
							},
						})
						.then(() => {
							// A command handled without a run, or a cancelled start, resolves here having started nothing.
							if (!accepted) { request.record(start.signal.aborted ? "cancelled" : "handled"); resolve(); }
						})
						.catch((error: unknown) => {
							if (accepted) request.owner.mapper.settled(false, error);
							else reject(new AppServerError("internal", error instanceof Error ? error.message : String(error)));
						});
				});
			});
			return request.result();
		} catch (error) {
			if (!start.signal.aborted) throw error;
			request.record("cancelled");
			return request.result();
		} finally {
			const owner = request.owner;
			owner.pendingStarts.delete(start);
			if (owner.reservedStart === start) owner.reservedStart = undefined;
			if (request.disposition !== "started" && owner.pendingTurnRequestId === request.requestId) owner.pendingTurnRequestId = undefined;
			this.startsBySignal.delete(start.signal);
		}
	}

	async queue(threadId: string, kind: "steer" | "followUp", text: string, images: ImageRef[] | undefined): Promise<void> {
		const thread = this.get(threadId);
		// A steer on an idle thread would sit in the queue until some later turn (§4.4). isStreaming, not the
		// mapper's turn: the run flag is set before turn/start answers (agent-session.ts:2145 calls
		// preflightResult, then _runAgentPrompt sets it synchronously), while agent_start comes later.
		if (!thread.session.isStreaming) throw new AppServerError("invalidParams", "no turn is running; use turn/start");
		const content = images?.map((image) => ({ type: "image" as const, ...image }));
		await (kind === "steer" ? thread.session.steer(text, content, { source: "rpc" }) : thread.session.followUp(text, content, { source: "rpc" }));
	}

	async interrupt(threadId: string): Promise<void> {
		const thread = this.threads.get(threadId);
		if (!thread) return;
		// Starts not yet launched stop here; turn/start answers cancelled with no turn (§5.6, §5.7).
		for (const start of thread.pendingStarts) start.abort();
		thread.abortPending();
		await thread.session.abort();
	}
```

The real signatures: `PromptOptions` (`agent-session.ts:315-326`: `images`, `source`, `preflightResult`, `streamingBehavior`, `expandPromptTemplates`), `steer`/`followUp(text, images?, { source? })` (`:2254-2276`), and `InputSource` is `"interactive" | "rpc" | "extension"` (`types.ts:1149`).

Handlers to add (all new):

```ts
			"turn/start": ({ threadId, text, images, requestId }, connection) => this.startTurn(threadId, text, images, connection, requestId),
			"turn/steer": ({ threadId, text, images }) => this.queue(threadId, "steer", text, images).then(() => ({})),
			"turn/followUp": ({ threadId, text, images }) => this.queue(threadId, "followUp", text, images).then(() => ({})),
			"turn/interrupt": ({ threadId }) => this.interrupt(threadId).then(() => ({})),
			"thread/compact": ({ threadId, instructions }, connection) =>
				this.ensureLoaded(threadId, connection.mode).then((thread) =>
					thread.exclusive(async () => {
						if (!thread.session.isIdle || thread.reservedStart) throw new AppServerError("turnInProgress", "a turn or replacement preflight is running");
						await thread.session.compact(instructions);
						return {};
					}),
				),
			"thread/settings/update": ({ threadId, model, thinkingLevel, approvalMode }, connection) =>
				this.ensureLoaded(threadId, connection.mode).then((thread) =>
					thread.exclusive(async () => {
						if (model) await this.setModel(thread, model.provider, model.id);
						if (thinkingLevel) thread.session.setThinkingLevel(thinkingLevel);
						if (approvalMode) this.setApprovalMode(thread, approvalMode);
						const summary = thread.toThread();
						thread.notify("thread/settings/updated", { thread: summary });
						return { thread: summary };
					}),
				),
```

`thread/settings/update` does not wait for an idle thread (§5.6): it runs on the queue so it cannot interleave with a turn's preflight or a compaction, and applies from the next model request, as the terminal's `/model` does mid-turn. `thread/compact` does need idle and answers `turnInProgress` otherwise.

`setApprovalMode` is a stub in this task (`thread.approvalMode = mode;`); Task 12 persists it.

- [ ] **Step 5a: Complete request ownership, bounded notifications and mapper regressions**

Create `packages/cli/src/app-server/start-request.ts`: `class StartRequest` has `readonly controller = new AbortController()`, mutable `owner: LoadedThread`, `readonly requestId: string` (globally unique client token or randomUUID), `disposition?: TurnStartResult["status"]`, `record(disposition: TurnStartResult["status"]): void` (first wins), and `result(): TurnStartResult` (current owner's id; reject unset disposition). ThreadManager holds `private readonly startsBySignal = new Map<AbortSignal, StartRequest>();`. LoadedThread gains `reservedStart?: AbortController` and `pendingTurnRequestId?: string`; Task 10 already passed its payload store from the manager. Reservations block competing starts/compactions until disposition, not interruption. Target exclusive settings operations wait for reservation release rather than interleaving setup/preflight; the forwarded continuation does not re-enter its own queue. Release wakes these waiters on every outcome. Pending starts count as target activity, preventing idle unload during unsubscribed forwarded preflight. Clear on all disposition/error/unload paths. Task 13 transfers the same controller; keep the request token until first `agent_start` consumes it. Independent extension-triggered runs have no token. Add top-level imports and these paths to this task's file/staging manifest.

Split text/reasoning deltas at Unicode code-point boundaries into ≤49,152 UTF-8 bytes. Use `thread.payloads.output` for oversized output updates and `thread.payloads.input` for approval requests; exactly one of input/inputRef is present, and clients resolve the latter before asking. Small copies and immutable references preserve reducer ordering. Completion carries only a turn summary. Large wire snapshots spool immutable segments without first cloning a whole arbitrarily large turn; retain `snapshot(): Turn | undefined` for small/raw tests and use the streaming writer for large wire snapshots.

Add tests for text→thinking, thinking→text, text→tool and dropped-block finalization. Both order and completed-item reducers delete on item/removed. Compare with read-back; reused ids must be removed before replacement start/completion, never afterward. An interrupted unfinished call followed by an active turn remains failed on live/read/paged history; only the explicit active id can have running unfinished calls. An empty-content error tool result still counts as a result and cannot be promoted.

Outcome tests: prompt→started; command/input without a run→handled; interrupted auth/hook/command preflight→cancelled; first disposition wins; early started-event correlation; unrelated extension runs lack a token. Never await completion for handled/cancelled. Include referenced running snapshots with later deltas buffered while chunk responses continue dispatching.

- [ ] **Step 6: Run tests, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/ test/suite/prompt-signal.test.ts`
Expected: PASS.

Run: `cd packages/cli && bun x vitest --run test/suite/plan-mode.test.ts test/suite/agent-session-runtime.test.ts`
Expected: PASS: the terminal passes no signal, so command dispatch is unchanged.

Run: `bun run check-types`

```bash
git add packages/cli/src/app-server/item-mapper.ts packages/cli/src/app-server/start-request.ts packages/cli/src/app-server/threads.ts packages/cli/src/app-server/loaded-thread.ts packages/cli/src/core/agent-session.ts packages/cli/src/core/extensions/runner.ts packages/cli/src/core/extensions/types.ts packages/cli/test/app-server/turns.test.ts packages/cli/test/app-server/fixtures/virtual-model-extension.ts packages/cli/test/suite/prompt-signal.test.ts
git commit -m "feat(cli): map session events to app server turns and items"
```

---

### Task 12: Approvals

**Files:**
- Create: `packages/cli/src/app-server/approvals.ts`, `packages/cli/test/app-server/approvals.test.ts`
- Modify: `packages/cli/src/app-server/threads.ts` (`threadExtensions` adds the gate; `setApprovalMode` persists; `load` writes the effective mode of a new thread and restores a saved one)

**Interfaces:**
- Consumes: `DECLINED_REASON`, `CANCELLED_REASON` (Task 10), `LoadedThread`, `defaultApprovalMode` (Task 9), `SubscriberGone` (Task 7).
- Produces: `needsApproval(mode: ApprovalMode, tool: string): boolean`; `createApprovalExtension(holder: { thread?: LoadedThread }): InlineExtension`; `APPROVAL_MODE_ENTRY = "knightcode.approvalMode"`; `readApprovalMode(entries: readonly SessionEntry[]): ApprovalMode | undefined`; `askApproval(thread, params, signal): Promise<ApprovalDecision>`.

Ordering (§5.4): `builtInExtensions` lists plan mode and the tools extension (classifier gate) before the thread's own extensions; the runner returns the first block (`runner.ts:1275-1288`), so a gate appended after them never sees a call they blocked.

Persistence (§5.4): the effective mode is written when a thread is created (start, fork, replacement), not only when the client named one. Otherwise a desktop thread created with the default `ask` resumes as `fullAccess` on a terminal connection. Restoring fails closed: a stored value that is not one of the three modes restores as `ask`.

Routing (§4.5): each attempt of a request is recorded in `thread.asks` with the subscriber it went to and its own abort controller, linked to the request's signal. A disconnect rejects the attempt with `SubscriberGone` (Task 7); an unsubscribe aborts the attempt's controller with `SubscriberGone` (Task 9's `withdrawFrom`), which makes `AppServer.request` send `serverRequest/cancelled` to that still-open connection and reject. Either way `askApproval` moves to the next subscriber, or answers `cancel` when none is left. Without the unsubscribe case, a desktop window that hides a thread, and with it the dialog, leaves the tool waiting on a connection that will never answer.

- [ ] **Step 1: Write the failing tests**

`packages/cli/test/app-server/approvals.test.ts`:

```ts
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { APPROVAL_MODE_ENTRY, needsApproval } from "../../src/app-server/approvals.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

test("which tools each mode asks for", () => {
	expect(["bash", "edit", "my_ext_tool"].filter((t) => needsApproval("ask", t))).toEqual(["bash", "edit", "my_ext_tool"]);
	expect(needsApproval("ask", "read")).toBe(false);
	expect(["bash", "edit", "my_ext_tool", "powershell"].filter((t) => needsApproval("autoEdit", t))).toEqual([
		"bash",
		"my_ext_tool",
		"powershell",
	]);
	expect(needsApproval("fullAccess", "bash")).toBe(false);
});

async function bashTurn(decide: (tool: string) => "accept" | "acceptForSession" | "decline", mode?: "ask" | "autoEdit" | "fullAccess") {
	const server = await startServer();
	const a = await server.connect("desktop");
	const asked: string[] = [];
	a.client.onRequest("item/toolCall/requestApproval", async (params) => {
		asked.push(params.tool);
		return { decision: decide(params.tool) };
	});
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd, ...(mode ? { approvalMode: mode } : {}) });
	return { ...server, a, asked, thread };
}

const toolCompleted = (params: Record<string, unknown>) => (params.item as { type: string }).type === "toolCall";

test("decline blocks with the rejection reason and the item reads declined", async () => {
	const { a, faux, asked, thread } = await bashTurn(() => "decline");
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "run it" });
	await a.waitFor("turn/completed");
	expect(asked).toEqual(["bash"]);
	const done = a.notifications.find((n) => n.method === "item/completed" && toolCompleted(n.params));
	expect((done!.params.item as { status: string }).status).toBe("declined");
});

test("acceptForSession stops later requests for that tool", async () => {
	const { a, faux, asked, thread } = await bashTurn(() => "acceptForSession");
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo 1" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo 2" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "run twice" });
	await a.waitFor("turn/completed");
	expect(asked).toEqual(["bash"]);
});

test("fullAccess never asks; autoEdit asks for bash but not edit", async () => {
	const full = await bashTurn(() => "accept", "fullAccess");
	full.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await full.a.client.request("turn/start", { threadId: full.thread.id, text: "go" });
	await full.a.waitFor("turn/completed");
	expect(full.asked).toEqual([]);

	const auto = await bashTurn(() => "accept", "autoEdit");
	writeFileSync(join(auto.cwd, "a.txt"), "x\n");
	auto.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "x", newText: "y" }] })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await auto.a.client.request("turn/start", { threadId: auto.thread.id, text: "go" });
	await auto.a.waitFor("turn/completed");
	expect(auto.asked).toEqual(["bash"]);
});

test("an explicit mode survives unload and resume", async () => {
	const { a, threads, thread, faux } = await bashTurn(() => "accept", "autoEdit");
	faux.setResponses([fauxAssistantMessage([fauxText("hi")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hello" });
	await a.waitFor("turn/completed");
	await threads.unload(thread.id);
	const { thread: resumed } = await a.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.approvalMode).toBe("autoEdit");
});

test("a desktop thread created with the default resumes as ask on a terminal connection", async () => {
	const { a, threads, thread, faux, connect } = await bashTurn(() => "accept");
	expect(thread.approvalMode).toBe("ask");
	faux.setResponses([fauxAssistantMessage([fauxText("hi")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hello" });
	await a.waitFor("turn/completed");
	await threads.unload(thread.id);
	const terminal = await connect("tui");
	const { thread: resumed } = await terminal.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.approvalMode).toBe("ask");
});

test("a malformed stored mode restores as ask", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const manager = SessionManager.create(cwd, sessionDir);
	manager.appendCustomEntry(APPROVAL_MODE_ENTRY, "yolo");
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 });
	const id = manager.getSessionId();
	manager.close();
	const terminal = await connect("tui");
	const { thread } = await terminal.client.request("thread/resume", { threadId: id });
	expect(thread.approvalMode).toBe("ask");
});

test("a disconnect with another subscriber moves the request", async () => {
	const server = await startServer();
	const first = await server.connect("desktop");
	const second = await server.connect("desktop");
	let asked!: () => void;
	const firstAsked = new Promise<void>((resolve) => (asked = resolve));
	first.client.onRequest("item/toolCall/requestApproval", () => {
		asked();
		return new Promise(() => {});
	});
	second.client.onRequest("item/toolCall/requestApproval", async () => ({ decision: "accept" }));
	const { thread } = await first.client.request("thread/start", { cwd: server.cwd });
	await second.client.request("thread/resume", { threadId: thread.id });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await first.client.request("turn/start", { threadId: thread.id, text: "go" });
	await firstAsked;
	first.close();
	const done = await second.waitFor("item/completed", toolCompleted);
	expect((done.item as { status: string }).status).toBe("completed");
});

test("an unsubscribe with another subscriber withdraws the request from it and moves it on", async () => {
	const server = await startServer();
	const first = await server.connect("desktop");
	const second = await server.connect("desktop");
	let asked!: () => void;
	const firstAsked = new Promise<void>((resolve) => (asked = resolve));
	first.client.onRequest("item/toolCall/requestApproval", () => {
		asked();
		return new Promise(() => {});
	});
	second.client.onRequest("item/toolCall/requestApproval", async () => ({ decision: "accept" }));
	const { thread } = await first.client.request("thread/start", { cwd: server.cwd });
	await second.client.request("thread/resume", { threadId: thread.id });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await first.client.request("turn/start", { threadId: thread.id, text: "go" });
	await firstAsked;
	// The connection stays open; it only stops watching the thread.
	await first.client.request("thread/unsubscribe", { threadId: thread.id });
	await first.waitFor("serverRequest/cancelled");
	const done = await second.waitFor("item/completed", toolCompleted);
	expect((done.item as { status: string }).status).toBe("completed");
});

test("an unsubscribe with no other subscriber blocks the call as cancelled", async () => {
	const server = await startServer();
	const only = await server.connect("desktop");
	let asked!: () => void;
	const onlyAsked = new Promise<void>((resolve) => (asked = resolve));
	only.client.onRequest("item/toolCall/requestApproval", () => {
		asked();
		return new Promise(() => {});
	});
	const { thread } = await only.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await only.client.request("turn/start", { threadId: thread.id, text: "go" });
	await onlyAsked;
	await only.client.request("thread/unsubscribe", { threadId: thread.id });
	await only.waitFor("serverRequest/cancelled");
	// Not subscribed any more: it sees the turn end through the sidebar broadcast (§4.5).
	await only.waitFor("thread/status/changed", (p) => p.threadId === thread.id && p.status === "idle");
	const turns = await only.readTurns(thread.id);
	const call = turns[0].items.find((i) => i.type === "toolCall");
	expect(call).toMatchObject({ status: "failed", output: [{ type: "text", text: "Tool call cancelled" }] });
});

test("a disconnect with no other subscriber blocks the call as cancelled, and it reads back so", async () => {
	const server = await startServer();
	const only = await server.connect("desktop");
	// Not subscribed: it sees the turn end through the sidebar broadcast (§4.5).
	const watcher = await server.connect("desktop");
	let asked!: () => void;
	const onlyAsked = new Promise<void>((resolve) => (asked = resolve));
	only.client.onRequest("item/toolCall/requestApproval", () => {
		asked();
		return new Promise(() => {});
	});
	const { thread } = await only.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await only.client.request("turn/start", { threadId: thread.id, text: "go" });
	await onlyAsked;
	only.close();
	await watcher.waitFor("thread/status/changed", (p) => p.threadId === thread.id && p.status === "idle");
	const turns = await watcher.readTurns(thread.id);
	const call = turns[0].items.find((i) => i.type === "toolCall");
	expect(call).toMatchObject({ status: "failed", output: [{ type: "text", text: "Tool call cancelled" }] });
});

test("a plan-mode block wins: no approval request is sent", async () => {
	const { a, faux, asked, thread, cwd } = await bashTurn(() => "accept");
	writeFileSync(join(cwd, "a.txt"), "x\n");
	// `/plan <task>` enters planning and runs the task as a turn (test/suite/plan-mode.test.ts:80).
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "x", newText: "y" }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("planning")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "/plan change a.txt" });
	const done = await a.waitFor("item/completed", toolCompleted);
	expect(asked).toEqual([]);
	expect(done.item).toMatchObject({ status: "failed", output: [{ type: "text", text: expect.stringContaining("Plan mode") }] });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/cli && bun x vitest --run test/app-server/approvals.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `approvals.ts`**

Restore the engine gate as the base, then rewrite:

```bash
git show 954451f04^:packages/cli/src/engine/permissions.ts > packages/cli/src/app-server/approvals.ts
```

```ts
/**
 * The approval gate (§5.4): a hidden inline extension per thread.
 *
 * The CLI has no permission system; the only interception point before a
 * tool runs is the `tool_call` extension event, whose handler may block. The
 * gate turns that event into an `item/toolCall/requestApproval` request to a
 * subscriber and blocks on anything but accept.
 */

import { type ApprovalDecision, ApprovalMode, type ServerRequestParams } from "@knightcode/app-server-protocol";
import { Compile } from "typebox/compile";
import type { InlineExtension } from "../core/extensions/types.ts";
import type { SessionEntry } from "../core/session-manager.ts";
import { SubscriberGone } from "./errors.ts";
import type { LoadedThread } from "./loaded-thread.ts";
import { CANCELLED_REASON, DECLINED_REASON } from "./transcript.ts";

const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(["read", "grep", "find", "ls", "ask_user", "submit_plan"]);
const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);
const isApprovalMode = Compile(ApprovalMode);

export const APPROVAL_MODE_ENTRY = "knightcode.approvalMode";

export function needsApproval(mode: ApprovalMode, tool: string): boolean {
	if (mode === "fullAccess" || READ_ONLY_TOOLS.has(tool)) return false;
	return mode === "ask" || !EDIT_TOOLS.has(tool);
}

/**
 * The mode stored on the branch: the latest entry decides. A value that is not a mode restores as
 * `ask`, the most restrictive one, rather than letting a corrupt file widen access (§5.4).
 */
export function readApprovalMode(entries: readonly SessionEntry[]): ApprovalMode | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== APPROVAL_MODE_ENTRY) continue;
		return isApprovalMode.Check(entry.data) ? (entry.data as ApprovalMode) : "ask";
	}
	return undefined;
}

/**
 * Ask the subscriber that most recently started a turn, then the others. A
 * subscriber that disconnects or unsubscribes passes the question on; with
 * nobody left the answer is cancel (§4.5). Each attempt is recorded in
 * `thread.asks` with its target, so `withdrawFrom` can take it back.
 */
export async function askApproval(
	thread: LoadedThread,
	params: ServerRequestParams<"item/toolCall/requestApproval">,
	signal: AbortSignal,
): Promise<ApprovalDecision> {
	const tried = new Set<unknown>();
	for (;;) {
		const candidates = [thread.lastTurnSubscriber, ...thread.subscribers].filter(
			(s): s is NonNullable<typeof s> => s !== undefined && thread.subscribers.has(s) && !tried.has(s),
		);
		const target = candidates[0];
		if (!target || signal.aborted) return "cancel";
		tried.add(target);
		// The attempt's own controller: aborted by the request's signal, or by withdrawFrom(target).
		const attempt = new AbortController();
		const forward = () => attempt.abort(signal.reason);
		signal.addEventListener("abort", forward, { once: true });
		const ask = { target, controller: attempt };
		thread.asks.add(ask);
		try {
			return (await target.request("item/toolCall/requestApproval", params, attempt.signal)).decision;
		} catch (error) {
			if (signal.aborted) return "cancel";
			if (error instanceof SubscriberGone) continue;
			throw error;
		} finally {
			thread.asks.delete(ask);
			signal.removeEventListener("abort", forward);
		}
	}
}

export function createApprovalExtension(holder: { thread?: LoadedThread }): InlineExtension {
	return {
		name: "app-server-approvals",
		hidden: true,
		factory: (knightcode) => {
			knightcode.on("tool_call", async (event, ctx) => {
				const thread = holder.thread;
				if (!thread || !needsApproval(thread.approvalMode, event.toolName) || thread.allowed.has(event.toolName)) {
					return undefined;
				}
				// The loop awaits this handler, so the request must release itself on abort.
				const controller = new AbortController();
				const onAbort = () => controller.abort();
				ctx.signal?.addEventListener("abort", onAbort, { once: true });
				thread.pending.add(controller);
				let decision: ApprovalDecision;
				try {
					decision = await askApproval(
						thread,
						{
							threadId: thread.id,
							turnId: thread.mapper.currentTurnId() ?? "",
							itemId: event.toolCallId,
							tool: event.toolName,
							...thread.payloads.input(event.input),
							...(event.parentToolCallId ? { parentItemId: event.parentToolCallId } : {}),
						},
						controller.signal,
					);
				} finally {
					thread.pending.delete(controller);
					ctx.signal?.removeEventListener("abort", onAbort);
				}
				if (decision === "acceptForSession") thread.allowed.add(event.toolName);
				if (decision === "accept" || decision === "acceptForSession") return undefined;
				return { block: true, reason: decision === "cancel" ? CANCELLED_REASON : DECLINED_REASON };
			});
		},
	};
}
```

Nested code-mode calls reach this handler through `_beforeToolCall(context, parentId)` (`agent-session.ts:788`).

A subscriber that leaves is handled on both paths. Disconnect: the thread manager removes it from `thread.subscribers` (Task 9), and a request in flight to it rejects with `SubscriberGone` (Task 7). Unsubscribe: `unsubscribe` removes it, then `withdrawFrom` aborts its attempt with a `SubscriberGone` reason; `AppServer.request` sends `serverRequest/cancelled` to the still-open connection and rejects with that reason (`signal.reason instanceof Error`). The candidates filter skips it from then on, because it is no longer in `thread.subscribers`.

The `tool_call` event carries `toolCallId`, `toolName`, `input` and `parentToolCallId` (`ToolCallEventBase`, `core/extensions/types.ts:1172-1182`), and the handler's `ctx.signal` is `AbortSignal | undefined` (`ExtensionContext`, `:360`): the run's signal while the agent streams.

- [ ] **Step 4: Wire it into `threads.ts`**

`threadExtensions(holder)` returns `[bridge, createApprovalExtension(holder)]`. `builtInExtensions` precede them in `extensionFactories`, which is the required order.

In `load`, choose the mode, then write it for a new thread:

```ts
			// A saved thread keeps its mode; a new one (start, fork, replacement) gets the effective mode
			// written, so any later connection restores the same mode (§5.4).
			const stored = reason === "resume" ? readApprovalMode(sessionManager.getBranch()) : undefined;
			const effective = stored ?? approvalMode ?? defaultApprovalMode(mode);
			if (reason !== "resume") sessionManager.appendCustomEntry(APPROVAL_MODE_ENTRY, effective);
			const thread = new LoadedThread(session, cwd, effective, () => this.scheduleIdle(thread), this.payloads);
```

replacing the `new LoadedThread(...)` line Task 9 wrote. Every caller that creates a thread (`start`, `fork`, Task 13's replacements) passes the mode it wants, so `approvalMode` is defined there; `resume` passes none.

`setApprovalMode`:

```ts
	private setApprovalMode(thread: LoadedThread, mode: ApprovalMode): void {
		if (thread.approvalMode === mode) return;
		thread.approvalMode = mode;
		thread.session.sessionManager.appendCustomEntry(APPROVAL_MODE_ENTRY, mode);
	}
```

A custom entry without conversation stays in memory until the first message (`_persist`), which is the session format's setup-entry rule. Its manager already owns the selected canonical destination (Task 2).

- [ ] **Step 5: Run tests, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/`
Expected: PASS.

Run: `bun run check-types`

```bash
git add packages/cli/src/app-server/approvals.ts packages/cli/src/app-server/threads.ts packages/cli/test/app-server/approvals.test.ts
git commit -m "feat(cli): add app server tool approvals"
```

---

### Task 13: Session replacement, commands and extension mode

**Files:**
- Modify: `packages/cli/src/app-server/threads.ts` (`bind`'s `newSession`, `fork`, `switchSession`; `replace`; handler `command/list`)
- Create: `packages/cli/test/app-server/replacement.test.ts`, `packages/cli/test/app-server/fixtures/replace-extension.ts`

**Interfaces:**
- Consumes: `ThreadManager.load`, `ensureLoaded`, `unload`, `subscribe`, `files`, `LoadedThread` (Tasks 9-12); `readSessionHeaderForDiscovery` (Task 9).
- Produces: `ThreadManager.replace(old: LoadedThread, obtain: () => Promise<LoadedThread>, reason: "new" | "resume" | "fork", signal?: AbortSignal, willDispatch?: boolean): Promise<LoadedThread>` (`signal` finds the initiating `StartRequest`; `willDispatch` reserves the target for a `withSession` prompt); handler `command/list`.

§4.5 gives the order, the same as `AgentSessionRuntime`'s (`agent-session-runtime.ts:196-367`):

1. The cancellable `session_before_switch` (new, resume) or `session_before_fork` on the old session; a cancel returns `{ cancelled: true }` and changes nothing.
2. The target comes through the one load path: a new session through `load`, an existing file through `ensureLoaded`. A target already loaded is reused; a target another process holds fails with `threadLockedElsewhere`.
3. Every subscription moves to the target; `thread/replaced` goes to them.
4. The old thread unloads now (`session_shutdown` with the replacement's reason and target file, then dispose), so its extension contexts go stale at once, as in the terminal. This does not wait on the old thread's queue: the caller is the command running on it.

- [ ] **Step 1: Write the fixture extension and failing tests**

`packages/cli/test/app-server/fixtures/replace-extension.ts`:

```ts
import type { ExtensionAPI } from "../../../src/index.ts";

export const seenModes: string[] = [];
export const shutdowns: string[] = [];
export const replaceState = { cancelSwitch: false, switchTarget: "" };

export default function replaceExtension(knightcode: ExtensionAPI): void {
	knightcode.on("session_start", (_event, ctx) => {
		seenModes.push(ctx.mode);
	});
	knightcode.on("session_shutdown", (event) => {
		shutdowns.push(event.reason);
	});
	knightcode.on("session_before_switch", () => (replaceState.cancelSwitch ? { cancel: true } : undefined));
	knightcode.registerCommand("fresh", {
		description: "Start a fresh session",
		handler: async (_args, ctx) => {
			await ctx.newSession();
		},
	});
	knightcode.registerCommand("goto", {
		description: "Switch to another session file",
		handler: async (_args, ctx) => {
			await ctx.switchSession(replaceState.switchTarget);
		},
	});
	knightcode.registerCommand("note", {
		description: "Send an extension message",
		handler: async () => {
			knightcode.sendMessage({ customType: "note", content: "noted", display: true }, { triggerTurn: true });
		},
	});
}
```

The signatures are the real ones: `registerCommand(name, { description, handler(args, ctx) })` (`core/extensions/types.ts:1548-1554, 1659`); `sendMessage(message, { triggerTurn?, deliverAs? })` (`:1710-1713`); a `session_before_switch` handler returns `{ cancel?: boolean }` (`SessionBeforeSwitchResult`, `:1481`); the command context has `newSession`, `fork` and `switchSession` (`:420-441`).

`packages/cli/test/app-server/replacement.test.ts`:

```ts
import { fauxAssistantMessage, fauxText } from "@knightcode/ai";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createGate } from "./fixtures/gate-extension.ts";
import replaceExtension, { replaceState, seenModes, shutdowns } from "./fixtures/replace-extension.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);
beforeEach(() => {
	seenModes.length = 0;
	shutdowns.length = 0;
	replaceState.cancelSwitch = false;
	replaceState.switchTarget = "";
});

const withFixture = () => startServer({ extraExtensions: [{ name: "replace", factory: replaceExtension }] });

test("ctx.newSession replaces the thread for every subscriber and unloads the old one at once", async () => {
	const server = await withFixture();
	const a = await server.connect();
	const b = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	await b.client.request("thread/resume", { threadId: thread.id });
	await a.client.request("turn/start", { threadId: thread.id, text: "/fresh" });
	const replaced = await b.waitFor("thread/replaced");
	expect(replaced.oldThreadId).toBe(thread.id);
	const next = (replaced.thread as { id: string }).id;
	expect(next).not.toBe(thread.id);
	await b.waitFor("thread/status/changed", (p) => p.threadId === thread.id && p.status === "notLoaded");
	expect(shutdowns).toContain("new");
	expect(server.threads.loadedCount()).toBe(1);
	server.faux.setResponses([fauxAssistantMessage([fauxText("hi")])]);
	await a.client.request("turn/start", { threadId: next, text: "hello" });
	await a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === next);
});

test("a session_before_switch cancel changes nothing", async () => {
	const server = await withFixture();
	replaceState.cancelSwitch = true;
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	await a.client.request("turn/start", { threadId: thread.id, text: "/fresh" });
	expect(a.notifications.some((n) => n.method === "thread/replaced")).toBe(false);
	expect(server.threads.get(thread.id).subscribers.size).toBe(1);
});

test("ctx.switchSession to a thread already loaded reuses its session", async () => {
	const server = await withFixture();
	const a = await server.connect();
	const { thread: target } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage([fauxText("saved")])]);
	await a.client.request("turn/start", { threadId: target.id, text: "save me" });
	await a.waitFor("turn/completed");
	const targetSession = server.threads.get(target.id).session;
	replaceState.switchTarget = server.threads.get(target.id).file!;
	const b = await server.connect();
	const { thread: source } = await b.client.request("thread/start", { cwd: server.cwd });
	await b.client.request("turn/start", { threadId: source.id, text: "/goto" });
	const replaced = await b.waitFor("thread/replaced");
	expect((replaced.thread as { id: string }).id).toBe(target.id);
	expect(server.threads.get(target.id).session).toBe(targetSession);
	expect(server.threads.get(target.id).subscribers.size).toBe(2);
	await b.waitFor("thread/status/changed", (p) => p.threadId === source.id && p.status === "notLoaded");
});

test("shutdown waits for a replacement whose target load is parked in an extension", async () => {
	// The first load (the thread itself) passes; the second (the replacement's new session) parks.
	const gate = createGate(1);
	const server = await startServer({
		extraExtensions: [
			{ name: "replace", factory: replaceExtension },
			{ name: "gate", factory: gate.extension },
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const fresh = a.client.request("turn/start", { threadId: thread.id, text: "/fresh" }).catch((error: unknown) => error);
	await gate.entered;
	const closing = server.threads.closeAll().then(() => gate.events.push("closeAll"));
	gate.open();
	await closing;
	await fresh;
	// The parked target and the old thread were both shut down before closeAll resolved.
	expect(gate.events).toEqual(["session_shutdown", "session_shutdown", "closeAll"]);
	expect(server.threads.loadedCount()).toBe(0);
});

test("extensions see ctx.mode desktop for a stdio-mode client and tui for in-process", async () => {
	const server = await withFixture();
	const desktop = await server.connect("desktop");
	await desktop.client.request("thread/start", { cwd: server.cwd });
	const terminal = await server.connect("tui");
	await terminal.client.request("thread/start", { cwd: server.cwd });
	expect(seenModes).toEqual(["desktop", "tui"]);
});

test("command/list returns extension commands, and sendMessage produces an extensionMessage item", async () => {
	const server = await withFixture();
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const { commands } = await a.client.request("command/list", { threadId: thread.id });
	expect(commands.map((c) => c.name)).toEqual(expect.arrayContaining(["fresh", "goto", "note"]));
	server.faux.setResponses([fauxAssistantMessage([fauxText("ack")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "/note" });
	const item = await a.waitFor("item/completed", (p) => (p.item as { type: string }).type === "extensionMessage");
	expect(item.item).toMatchObject({ extension: "note", text: "noted" });
});
```

`seenModes` and `shutdowns` are module state shared across threads in the process; that is the documented behaviour (Task 5's docs paragraph). `session_start` runs inside `bindExtensions`, which carries the mode. `/note` with `triggerTurn: true` starts a run (`sendCustomMessage`, `agent-session.ts:2357-2362`), so the custom message lands inside a turn.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/cli && bun x vitest --run test/app-server/replacement.test.ts`
Expected: FAIL (`newSession` returns `{ cancelled: true }`; `command/list` missing).

- [ ] **Step 3: Implement replacement**

In `threads.ts`, a helper mirroring the runtime's `emitBeforeSwitch` and `emitBeforeFork` (`agent-session-runtime.ts:130-165`; copy their event shapes):

```ts
	/** The runtime's cancellable hooks, on the old session (§4.5 step 1). */
	private async cancelled(
		thread: LoadedThread,
		event:
			| { type: "session_before_switch"; reason: "new" | "resume"; targetSessionFile?: string }
			| { type: "session_before_fork"; entryId: string; position: "before" | "at" },
	): Promise<boolean> {
		const runner = thread.session.extensionRunner;
		if (!runner.hasHandlers(event.type)) return false;
		return (await runner.emit(event))?.cancel === true;
	}
```

`bind(thread, mode)`'s actions:

```ts
				newSession: async (options) => {
					if (await this.cancelled(thread, { type: "session_before_switch", reason: "new" })) return { cancelled: true };
					const sessionManager = SessionManager.create(thread.session.sessionManager.getCwd(), liveDirFor(this.ctx, thread.projectCwd));
					if (options?.parentSession) sessionManager.newSession({ parentSession: options.parentSession });
					const next = await this.replace(thread, () => this.load(sessionManager, mode, "new", thread.approvalMode), "new", options?.signal, options?.withSession !== undefined);
					if (options?.setup) {
						await options.setup(next.session.sessionManager);
						next.session.refreshContext();
					}
					if (options?.preserveModel && thread.session.model) {
						await next.session.setModel(thread.session.model);
						next.session.setThinkingLevel(thread.session.thinkingLevel);
					}
					if (options?.withSession) await options.withSession(next.session.createReplacedSessionContext());
					return { cancelled: false };
				},
				fork: async (entryId, options) => {
					const position = options?.position ?? "before";
					if (await this.cancelled(thread, { type: "session_before_fork", entryId, position })) return { cancelled: true };
					const file = thread.file;
					if (!file || !existsSync(file)) throw new Error("This session has not been saved yet.");
					const entry = thread.session.sessionManager.getEntry(entryId);
					if (!entry) throw new Error("Invalid entry ID for forking");
					const leaf = position === "at" ? entry.id : entry.type === "message" && entry.message.role === "user" ? entry.parentId : undefined;
					if (leaf === undefined) throw new Error("Invalid entry ID for forking");
					const dir = liveDirFor(this.ctx, thread.projectCwd);
					const cwd = thread.session.sessionManager.getCwd();
					let sessionManager: SessionManager;
					if (leaf === null) {
						// Forking before the first user message: an empty session that names its parent, as the runtime does.
						sessionManager = SessionManager.create(cwd, dir);
						sessionManager.newSession({ parentSession: file });
					} else {
						// One file with only the path to `leaf` (Task 2); no full copy to delete afterwards.
						sessionManager = SessionManager.forkFrom(file, cwd, dir, { leafId: leaf });
					}
					const next = await this.replace(thread, () => this.load(sessionManager, mode, "fork", thread.approvalMode), "fork", options?.signal, options?.withSession !== undefined);
					if (options?.withSession) await options.withSession(next.session.createReplacedSessionContext());
					return { cancelled: false };
				},
				switchSession: async (sessionPath, options) => {
					const target = resolvePath(sessionPath);
					if (await this.cancelled(thread, { type: "session_before_switch", reason: "resume", targetSessionFile: target })) {
						return { cancelled: true };
					}
					const id = readSessionHeaderForDiscovery(target)?.id;
					if (!id) throw new Error(`Not a session file: ${sessionPath}`);
					// Through the one load path: a loaded target is reused; one held elsewhere fails (§5.6).
					this.files.remember(id, target);
					const next = await this.replace(thread, () => this.ensureLoaded(id, mode), "resume", options?.signal, options?.withSession !== undefined);
					if (options?.withSession) await options.withSession(next.session.createReplacedSessionContext());
					return { cancelled: false };
				},
```

The `fork` action's empty-session branch matches `agent-session-runtime.ts:313-327`. `switchSession` ignores `options.cwdOverride` in Phase A (the app server has no missing-cwd prompt); add it when a desktop flow needs it.

```ts
	/** Load the target, move every subscriber from `old`, say so, and unload `old` now (§4.5). */
	async replace(old: LoadedThread, obtain: () => Promise<LoadedThread>, reason: "new" | "resume" | "fork", signal?: AbortSignal, willDispatch = false): Promise<LoadedThread> {
		const next = await obtain();
		if (next === old) return old;
		const request = signal && this.startsBySignal.get(signal);
		if (request && request.owner === old) {
			if (willDispatch && (next.busy || next.reservedStart || next.pendingStarts.size > 0)) {
				throw new AppServerError("turnInProgress", "replacement target is busy");
			}
			old.pendingStarts.delete(request.controller);
			request.owner = next;
			next.pendingStarts.add(request.controller);
			if (willDispatch) next.reservedStart = request.controller;
			if (old.pendingTurnRequestId === request.requestId) old.pendingTurnRequestId = undefined;
			next.pendingTurnRequestId = request.requestId;
		}
		// An interrupt during obtain remains aborted; never mint a fresh signal for withSession.
		for (const subscriber of [...old.subscribers]) {
			old.subscribers.delete(subscriber);
			this.subscribe(next, subscriber);
		}
		next.lastTurnSubscriber = old.lastTurnSubscriber ?? next.lastTurnSubscriber;
		old.lastTurnSubscriber = undefined;
		next.notify("thread/replaced", { oldThreadId: old.id, thread: next.toThread() });
		// As the terminal's teardownCurrent: shutdown and dispose now, so a captured ctx goes stale at once.
		// Without waiting on old's queue: the caller is the command running on it (a turn/start's preflight).
		await this.unload(old.id, reason, next.file, { waitForQueue: false });
		return next;
	}
```

Add `readSessionHeaderForDiscovery` to the imports. Keep loads tracked through shutdown. Check the initiating signal after replacement/setup awaits and before withSession; never dispatch after cancellation. A cancelled load may finish the switch, but its result is cancelled and it starts no target run. Before-publication rejection leaves subscriptions unchanged and unloads only a newly created, unclaimed target, never a reused target with other owners.

Add real `/plan approve fresh` and fixture new/fork/switch withSession tests: old disposal leaves the forwarded signal non-aborted, exactly one target turn starts, result→started with target id/token, no source run. Gate loading/setup/forwarded input and interrupt each: result→cancelled, no target turn, no leaked controller/reservation. Include target unload/shutdown, cancelled before-switch hook, same-thread switch, active target and a competing start unable to overtake its reservation. A hook-cancelled replacement without an abort is a handled command. Unrelated old-thread queued starts are cancelled, not transferred.

`command/list`, from the engine's `commandsOf` (`sessions.ts:173-183`):

```ts
			"command/list": async ({ threadId }) => {
				const { session } = this.get(threadId);
				return {
					commands: [
						...session.extensionRunner
							.getRegisteredCommands()
							.map((c) => ({ name: c.invocationName, description: c.description ?? "" })),
						...session.promptTemplates.map((t) => ({ name: t.name, description: t.description ?? "" })),
						...session.resourceLoader.getSkills().skills.map((s) => ({ name: `skill:${s.name}`, description: s.description ?? "" })),
					],
				};
			},
```

- [ ] **Step 4: Run tests, type check, commit**

Run: `cd packages/cli && bun x vitest --run test/app-server/`
Expected: PASS.

Run: `bun run check-types`

```bash
git add packages/cli/src/app-server/threads.ts packages/cli/test/app-server/replacement.test.ts packages/cli/test/app-server/fixtures/replace-extension.ts
git commit -m "feat(cli): replace app server threads from extension commands"
```

---

### Task 14: The `knightcode app-server` subcommand

**Files:**
- Create: `packages/cli/src/app-server/entry.ts`, `packages/cli/test/app-server/stdio.test.ts`, `packages/cli/test/app-server/fixtures/faux-extension.ts`
- Modify: `packages/cli/src/main.ts` (dispatch beside `args[0] === "mcp"`), `packages/cli/src/core/output-guard.ts` (`writeRawStdoutReporting`: a write that reports failure instead of exiting)

**Interfaces:**
- Consumes: everything above.
- Produces: `runAppServer(args: string[]): Promise<void>`; `appServerHandlers(ctx, threads): Handlers` (thread, turn, account, model, config handlers merged).

Flags: `-e`/`--extension <path>` (repeatable; extra extension paths, resolved against the process cwd, loaded in every thread as trusted CLI paths) and `--session-dir <dir>`. The session dir falls back to `KNIGHTCODE_CODING_AGENT_SESSION_DIR`, then the global setting, as `main.ts:802-806` does.

Discovery (§5.2): an extension registers its providers when a thread loads it, so a client starts a thread first, then reads `model/list`, then picks a model. The stdio test follows that order.

Shutdown (§5.6): the 10-second deadline starts the moment stdin ends or a signal arrives, not when the transport finishes draining, and it bounds everything after: `closeAll()`, the answers to requests accepted before EOF, the final stdout flush, and the drain itself. It is a plain timer that calls `process.exit`, so neither a client that stopped reading stdout nor a turn that ignores abort can keep the process alive. Within the deadline the order is: stop reading, unload everything (which settles every accepted request one way or another), let the connection write those answers and close its output, flush, exit.

- [ ] **Step 1: Write the fixture and the failing tests**

`packages/cli/test/app-server/fixtures/faux-extension.ts`:

```ts
import { appendFileSync } from "node:fs";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@knightcode/ai";
import type { ExtensionAPI } from "../../../src/index.ts";

/**
 * Registers a faux provider so a spawned app server never reaches a real one, and records session_shutdown
 * in the file KC_TEST_SHUTDOWN_FILE names, so a test can see that shutdown reached the extensions.
 */
export default function fauxExtension(knightcode: ExtensionAPI): void {
	knightcode.on("session_shutdown", () => {
		const mark = process.env.KC_TEST_SHUTDOWN_FILE;
		if (mark) appendFileSync(mark, "session_shutdown\n");
	});
	const faux = fauxProvider({ provider: "faux-e2e", tokensPerSecond: 50 });
	faux.setResponses([
		fauxAssistantMessage([fauxText("hello from the app server")]),
		fauxAssistantMessage([fauxText("a long answer ".repeat(40))]),
	]);
	knightcode.registerProvider(faux.provider);
}
```

`ExtensionAPI.registerProvider` has an overload taking a `Provider` object (`core/extensions/types.ts:1837`); the loader routes it to the runtime's `registerNativeProvider`.

`packages/cli/test/app-server/stdio.test.ts`:

```ts
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "@knightcode/app-server-protocol";
import { afterEach, expect, test } from "vitest";
import { attachJsonlLineReader } from "../../src/modes/rpc/jsonl.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function spawnServer() {
	const agentDir = mkdtempSync(join(tmpdir(), "knightcode-as-e2e-agent-"));
	const cwd = mkdtempSync(join(tmpdir(), "knightcode-as-e2e-cwd-"));
	dirs.push(agentDir, cwd);
	const shutdownMark = join(agentDir, "shutdown-mark");
	const child = spawn(process.execPath, ["src/cli.ts", "app-server", "-e", join(import.meta.dirname, "fixtures/faux-extension.ts")], {
		cwd: join(import.meta.dirname, "../.."),
		env: { ...process.env, KNIGHTCODE_CODING_AGENT_DIR: agentDir, KC_TEST_SHUTDOWN_FILE: shutdownMark },
		stdio: ["pipe", "pipe", "inherit"],
	});
	const lines: Array<Record<string, unknown>> = [];
	const waiters = new Set<() => void>();
	attachJsonlLineReader(child.stdout!, (line) => {
		lines.push(JSON.parse(line));
		for (const wake of [...waiters]) wake();
	});
	const waitFor = (predicate: (m: Record<string, unknown>) => boolean) =>
		new Promise<Record<string, unknown>>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("timed out")), 30_000);
			const check = () => {
				const hit = lines.find(predicate);
				if (!hit) return;
				clearTimeout(timer);
				waiters.delete(check);
				resolve(hit);
			};
			waiters.add(check);
			check();
		});
	const send = (message: unknown) => child.stdin!.write(`${JSON.stringify(message)}\n`);
	return { child, cwd, waitFor, send, shutdownMark };
}

async function handshakeAndThread(s: ReturnType<typeof spawnServer>): Promise<string> {
	s.send({ id: 1, method: "initialize", params: { clientInfo: { name: "e2e", version: "0" }, protocolVersion: PROTOCOL_VERSION, capabilities: {} } });
	await s.waitFor((m) => m.id === 1);
	s.send({ method: "initialized", params: {} });
	// The thread loads the -e extension, which registers the faux provider (§5.2).
	s.send({ id: 2, method: "thread/start", params: { cwd: s.cwd } });
	const thread = ((await s.waitFor((m) => m.id === 2)).result as { thread: { id: string } }).thread;
	s.send({ id: 3, method: "model/list", params: {} });
	const models = (await s.waitFor((m) => m.id === 3)).result as { models: Array<{ provider: string; id: string }> };
	const faux = models.models.find((m) => m.provider === "faux-e2e")!;
	s.send({ id: 4, method: "thread/settings/update", params: { threadId: thread.id, model: { provider: faux.provider, id: faux.id } } });
	await s.waitFor((m) => m.id === 4);
	return thread.id;
}

const exitCode = (child: ChildProcess) => new Promise<number | null>((resolve) => child.on("exit", resolve));

test("a response sent just before stdin closes still reaches the client", async () => {
	const s = spawnServer();
	const exited = exitCode(s.child);
	s.send({ id: 1, method: "initialize", params: { clientInfo: { name: "e2e", version: "0" }, protocolVersion: PROTOCOL_VERSION, capabilities: {} } });
	s.child.stdin!.end();
	expect((await s.waitFor((m) => m.id === 1)).result).toMatchObject({ protocolVersion: PROTOCOL_VERSION });
	expect(await exited).toBe(0);
}, 60_000);

test("a client that stops reading stdout cannot keep the server alive past the deadline", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "knightcode-as-e2e-agent-"));
	dirs.push(agentDir);
	// stdout is piped and never read, so the pipe fills and writes block.
	const child = spawn(process.execPath, ["src/cli.ts", "app-server"], {
		cwd: join(import.meta.dirname, "../.."),
		env: { ...process.env, KNIGHTCODE_CODING_AGENT_DIR: agentDir },
		stdio: ["pipe", "pipe", "inherit"],
	});
	const exited = exitCode(child);
	// Each line is answered with a notInitialized error: megabytes of output nobody reads.
	const lines = Array.from({ length: 20_000 }, (_, i) => JSON.stringify({ id: i, method: "model/list", params: {} })).join("\n");
	child.stdin!.write(`${lines}\n`);
	const started = Date.now();
	child.stdin!.end();
	expect(await exited).toBe(0);
	expect(Date.now() - started).toBeLessThan(20_000);
}, 60_000);

test("knightcode app-server completes a handshake and a faux turn over stdio, and exits on EOF", async () => {
	const s = spawnServer();
	const threadId = await handshakeAndThread(s);
	s.send({ id: 5, method: "turn/start", params: { threadId, text: "hi" } });
	const done = await s.waitFor((m) => m.method === "turn/completed");
	expect((done.params as { turn: { status: string } }).turn.status).toBe("completed");
	const exited = exitCode(s.child);
	s.child.stdin!.end();
	expect(await exited).toBe(0);
}, 60_000);

test("a client whose end of stdout is gone still gets an orderly shutdown: extensions hear session_shutdown, exit 0", async () => {
	const s = spawnServer();
	await handshakeAndThread(s);
	const exited = exitCode(s.child);
	// The desktop app died: its read end of our stdout closes, so the next write fails with EPIPE.
	s.child.stdout!.destroy();
	s.send({ id: 9, method: "model/list", params: {} });
	expect(await exited).toBe(0);
	expect(readFileSync(s.shutdownMark, "utf8")).toContain("session_shutdown");
}, 60_000);

test("closing stdin mid-turn unloads everything and exits 0 within the deadline", async () => {
	const s = spawnServer();
	const threadId = await handshakeAndThread(s);
	s.send({ id: 5, method: "turn/start", params: { threadId, text: "hi" } });
	await s.waitFor((m) => m.id === 5);
	s.send({ id: 6, method: "turn/start", params: { threadId, text: "long" } });
	await s.waitFor((m) => m.method === "item/agentMessage/delta");
	const exited = exitCode(s.child);
	const started = Date.now();
	s.child.stdin!.end();
	expect(await exited).toBe(0);
	expect(Date.now() - started).toBeLessThan(15_000);
}, 60_000);
```

The unread-stdout test depends on stdout writes being asynchronous: Node makes pipe writes synchronous on Linux, and a synchronous write into a full pipe freezes the event loop, so no timer can fire. Run it on each OS CI covers. If it hangs on one, read `writeRawStdoutChunk` in `output-guard.ts`; the fix is a non-blocking write path for fd 1 on that platform, not a weaker test. Say which platforms passed in the commit message.

`process.execPath` is Bun under `bun x vitest`. The temp agent dir has no settings, so the thread starts on whatever model is available or none; the test then pins the faux model.

The second test's `id: 6` may answer `turnInProgress` if the first turn has not settled; that is fine as long as a delta streams. If the first reply settles too fast to overlap, drop `id: 5` and use the long reply first by swapping the fixture's responses.

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/cli && bun x vitest --run test/app-server/stdio.test.ts`
Expected: FAIL (`app-server` is parsed as a prompt).

- [ ] **Step 3: Add a stdout write that reports failure instead of exiting**

`writeRawStdout` exits the process with status 1 on any write error, EPIPE included. For the app server that is a second exit path that wins over shutdown: when the desktop app dies, the next write fails and the process exits before `closeAll`, so extensions never see `session_shutdown` and locks wait to go stale. Leave `writeRawStdout` as it is for the terminal and print mode, and add beside it in `packages/cli/src/core/output-guard.ts`:

```ts
/**
 * Write to the real stdout in order, sharing writeRawStdout's queue. A failed write rejects the returned
 * promise instead of exiting, so a server whose client closed the pipe (EPIPE) can shut down in order.
 */
export function writeRawStdoutReporting(text: string): Promise<void> {
	if (text.length === 0) return Promise.resolve();
	const write = rawStdoutWriteTail.then(() => writeRawStdoutChunk(text));
	// The shared tail must survive one failure, or every later write would reject without being tried.
	rawStdoutWriteTail = write.catch(() => {});
	return write;
}
```

The stdio transport turns that rejection into `close("abort")` (Task 6), `AppServer` reports the close, and `runAppServer`'s `exit` runs `closeAll` as for EOF.

- [ ] **Step 4: Implement `entry.ts`**

```ts
/**
 * `knightcode app-server`: the protocol over stdio (§5.1).
 *
 * stdout carries only protocol lines; everything else goes to stderr. The
 * process exits when stdin closes, after unloading every thread so each lock
 * is released and each extension sees session_shutdown, or after a deadline.
 */

import { parseArgs as parseNodeArgs } from "node:util";
import { ENV_SESSION_DIR, expandTildePath, getAgentDir, VERSION } from "../config.ts";
import { flushRawStdout, takeOverStdout, writeRawStdoutReporting } from "../core/output-guard.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { normalizePath, resolvePath } from "../utils/paths.ts";
import { accountHandlers } from "./accounts.ts";
import { type AppServerContext, createAppServerContext } from "./context.ts";
import { modelHandlers } from "./models.ts";
import { AppServer, type Handlers } from "./server.ts";
import { createStdioTransport } from "./stdio.ts";
import { ThreadManager } from "./threads.ts";

/** A turn that ignores abort must not keep the process alive after its client is gone (§5.6). */
const SHUTDOWN_DEADLINE_MS = 10_000;

export function appServerHandlers(ctx: AppServerContext, threads: ThreadManager): Handlers {
	return { ...threads.handlers(), ...accountHandlers(ctx), ...modelHandlers(ctx) };
}

export async function runAppServer(args: string[]): Promise<void> {
	takeOverStdout();
	// A failed stdout write (EPIPE) is reported through its write callback (writeRawStdoutReporting). The stream
	// also emits it as an error event, which Node would throw as an uncaught exception without a listener.
	process.stdout.on("error", () => {});
	let values: { extension?: string[]; "session-dir"?: string };
	try {
		({ values } = parseNodeArgs({
			args,
			options: { extension: { type: "string", short: "e", multiple: true }, "session-dir": { type: "string" } },
			strict: true,
		}));
	} catch (error) {
		process.stderr.write(`knightcode app-server: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	}
	const agentDir = getAgentDir();
	const envSessionDir = process.env[ENV_SESSION_DIR];
	const sessionDir =
		(values["session-dir"] ? normalizePath(values["session-dir"]) : undefined) ??
		(envSessionDir ? expandTildePath(envSessionDir) : undefined) ??
		SettingsManager.create(process.cwd(), agentDir, { projectTrusted: false }).getSessionDir();
	const ctx = await createAppServerContext({ agentDir, sessionDir });
	const threads = new ThreadManager(ctx, { extensionPaths: (values.extension ?? []).map((path) => resolvePath(path)) });
	const transport = createStdioTransport(process.stdin, writeRawStdoutReporting);
	// Output closes after the connection answered everything it accepted (Task 7), or on abort.
	const outputClosed = new Promise<void>((resolve) => transport.onClose(resolve));
	let exiting = false;
	const exit = async () => {
		if (exiting) return;
		exiting = true;
		// Hard deadline from the moment shutdown begins. Not unref'd: it must fire even while a stuck turn or
		// a pending asynchronous stdout write is all that keeps the event loop alive. A synchronous write that
		// blocks the loop stops every timer, this one included; stdout writes must therefore be asynchronous
		// (see the unread-stdout test note), never a reason for a second exit path.
		setTimeout(() => process.exit(0), SHUTDOWN_DEADLINE_MS);
		// No new work; requests already accepted still get their answers (§5.6).
		connection.endInput();
		// Unloading cancels starts in preflight and fails loads with shuttingDown, so every accepted request settles.
		await threads.closeAll();
		await outputClosed;
		// After EPIPE there is nobody to flush to; shutdown already ran, so a flush failure changes nothing.
		await flushRawStdout().catch(() => {});
		process.exit(0);
	};
	const connection = new AppServer({
		transport,
		mode: "desktop",
		version: VERSION,
		handlers: appServerHandlers(ctx, threads),
		onInitialized: (c) => ctx.connections.add(c),
		// EOF: the desktop app closed its end or crashed. Its subscriptions go, and shutdown starts.
		onInputEnd: (c) => {
			threads.disconnect(c);
			void exit();
		},
		onClose: (c) => {
			ctx.connections.delete(c);
			threads.disconnect(c);
			void exit();
		},
	});
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.once(signal, () => void exit());
	}
}
```

`SettingsManager.getSessionDir()` returns `string | undefined` (`settings-manager.ts:704`); `createAppServerContext` takes undefined as the per-project default layout.

- [ ] **Step 5: Dispatch from `main.ts`**

Import `runAppServer` from `./app-server/entry.ts` at the top. After the `mcp` block (`:728-732`):

```ts
	if (args[0] === "app-server") {
		await runAppServer(args.slice(1));
		return;
	}
```

`main()` returns while stdin keeps the process alive; `exit()` ends it.

- [ ] **Step 6: Run the tests, type check**

Run: `cd packages/cli && bun x vitest --run test/app-server/stdio.test.ts`
Expected: PASS.

Run: `bun run check-types`

- [ ] **Step 7: Measure memory**

Perform a preliminary baseline/one-thread/ten-distinct-cwd measurement with a temporary faux-provider script, waiting on explicit startup/thread responses rather than a fixed sleep. Read RSS/working set with `ps -o rss= -p <pid>` on POSIX or `(Get-Process -Id <pid>).WorkingSet64` through a spawned PowerShell argument array on Windows. Publish date, OS, fixture size and raw results in architecture §13. This is preliminary only: Task 15's same-cwd, representative-history, post-unload and 100-cycle measurements are required before acceptance. Remove the script.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/app-server/entry.ts packages/cli/src/core/output-guard.ts packages/cli/src/main.ts packages/cli/test/app-server/stdio.test.ts packages/cli/test/app-server/fixtures/faux-extension.ts apps/desktop/docs/desktop-app/architecture.md
git commit -m "feat(cli): add the knightcode app-server subcommand"
```

---

### Task 15: Docs and changeset

**Files:**
- Create: `packages/cli/docs/app-server.md`
- Modify: `packages/cli/docs/cli.md` (subcommand), `sessions.md`, `session-format.md`, `sdk.md`, `packages/cli/src/index.ts` (public ownership errors), `packages/cli/README.md` only if it lists subcommands
- Create: `.changeset/<branch>-2.md` (via `bun run changeset`)

- [ ] **Step 1: Write `packages/cli/docs/app-server.md`**

Sections, each short and concrete:

1. What it is: one process, many threads, stdio ndjson, JSON-RPC 2.0 shapes without `"jsonrpc"`. Who uses it: the desktop app spawns it; a script can too.
2. Starting it: `knightcode app-server [-e <extension>]... [--session-dir <dir>]`. stdout is protocol only; logs on stderr; exits when stdin closes.
3. Handshake: `initialize` (with a full example line) then `initialized`; `versionMismatch` and `notInitialized`.
4. Threads and turns: `thread/start`, then `model/list` (extension providers appear once a thread has loaded them), `turn/start`, the notification sequence of one turn (copy the order from Task 11's first test), ids, order and statuses (one paragraph: a turn is one agent run between a start and an end entry; item ids are ordinals; items carry `index`, their position in the turn, and a client orders by it because a streaming item's index can change at its message's end; `item/removed` withdraws a streamed item a `message_end` handler dropped; a turn without an end entry reads back `interrupted`). Which notifications every connection gets and which only subscribers get (§4.5); `thread/resume` returns a separate current running snapshot even with an old history cursor: install it before buffered deltas. Document start dispositions/tokens, anchored history and expiring listing cursors, invalidCursor, refs/chunks, and item-free turn completion.
5. Approvals: the three modes and their table from §5.4, the request and its four decisions, defaults (desktop `ask`, terminal `fullAccess`).
6. Locks: one process per session file; `threadLockedElsewhere`; `thread/read` needs no lock and never writes; a lock lost to another process closes the thread with an `error` notification.
7. Idle unload and shutdown: 10 minutes without a subscriber and nothing running; on stdin EOF every thread unloads, with a 10-second deadline.
8. Limits and shutdown: 64 MiB per stdin line, in UTF-8 bytes (dropped with an error), 64 MiB of unread output before close; history responses ≤1 MiB, inline turns/items ≤64 KiB, chunks ≤48 KiB before base64. Large valid transcripts use immutable references. Initial listing scans transcripts; continuations use expiring summaries. Cache retains ≤256 inactive factories plus leased active entries. Document payload expiry/re-read and no arbitrary path access. Closing stdin ends input, not output: requests already sent are still answered, a request the server could not finish answers `shuttingDown`, then stdout closes.
9. Reference: "Every message is defined in [app-server.schema.json](app-server.schema.json)." Regenerate with `cd packages/app-server-protocol && bun run generate:schema`.

Hand-wrap prose at 80 columns. No emojis.

- [ ] **Step 2: `cli.md`**

Add `knightcode app-server` beside the other subcommands (`mcp`, `config`, the package commands), one paragraph, linking `app-server.md`.

- [ ] **Step 2a: Update session-format and SDK documentation**

`sessions.md`: canonical file/parent ownership, symlink/junction aliases, hard-link refusal, stale takeover, read-only readers, archive collision/destination ownership, fork offer, close/reopen. `session-format.md`: knightcode.turn/turnEnd custom-entry shapes, ordinal item ids, retry/follow-up boundaries, interrupted missing ends and legacy fallback. `sdk.md`: dispose closes the persisted manager and releases virtual routes/cache leases; post-bind setSessionFile failure closes it, acquisition failure retains the old binding. Export SessionLockedError, SessionHardLinkedError, SessionClosedError and SessionLockLostError from src/index.ts. Add a public-export regression to test/session-manager-lock.test.ts and run it. Show a short SDK catch/fork/reopen example that does not parse strings or reuse a disposed manager. Document AppServerError.data in the client reference; maintain cross-links. These changes ship with implementation, not ahead of it.

- [ ] **Step 3: Changeset**

Run: `bun run changeset added` and complete:

> Added `knightcode app-server`, a headless server that hosts many sessions in one process over a JSON-RPC protocol on stdio, with per-thread tool approvals and idle unloading.

Run: `bun run scripts/changelog-sections.ts`. Expected: passes.

- [ ] **Step 4: Validate (spec §13)**

Run each and confirm:

```bash
bun run check-types
cd packages/app-server-protocol && bun x vitest --run && cd ../..
cd packages/cli && bun x vitest --run test/app-server/ test/session-lock.test.ts test/session-lock-process.test.ts test/session-manager-lock.test.ts test/main-session-lock.test.ts test/model-runtime-virtual-owner.test.ts test/extension-cache-cwd.test.ts test/suite/turn-marker.test.ts test/suite/prompt-signal.test.ts test/suite/agent-session-runtime.test.ts && cd ../..
bun x prettier --check "packages/app-server-protocol/**/*.ts" "packages/cli/src/app-server/**/*.ts"
bun run scripts/changelog-sections.ts
rg -n "from \"@knightcode/(ai|agent)\"" packages/app-server-protocol/src
rg -n "exec\(|execSync\(|shell: true" packages/cli/src/app-server
```

Expected: the type check and tests pass, prettier reports no changes, both `rg` commands print nothing.

- [ ] **Step 4a: Record listing and memory acceptance measurements**

Use a temporary faux-provider script. Windows/POSIX: cold/warm listing with 1,000/10,000 sessions, including 100 MiB transcripts; record bytes read, latency, peak heap and no-rescan continuation timings. Record baseline, ten same-cwd and ten distinct-cwd threads with histories/media/tools, then unloaded retained heap/working set after controlled GC. Repeat 100 distinct-project open/run/unload cycles including failed loads/virtual routes; record factory counts, runtime owners/routes, payload files/bytes and post-expiry retention. Inactive factories ≤256; disposed sessions/routes and expired payloads must not accumulate. Report runtime module/allocator retention separately. Publish commands, fixture sizes and results in architecture §13 before Phase A acceptance; do not invent passing MB/latency values. Remove the script. Continued growth after module warm-up requires investigation.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/docs/app-server.md packages/cli/docs/cli.md packages/cli/docs/sessions.md packages/cli/docs/session-format.md packages/cli/docs/sdk.md packages/cli/src/index.ts packages/cli/test/session-manager-lock.test.ts .changeset/<the file bun run changeset created>.md
git commit -m "docs(cli): document the app server"
```

---

## Spec coverage (self-review)

| Spec | Task |
| --- | --- |
| §2 decisions: lock contract, owned virtual-model routes, turn identity | 2, 4, 5 |
| §4.1 envelopes, handshake, error codes | 1, 7 |
| §4.2 data types, ids, markers and end entries, read-back, durable vs live, explicit item `index`, finalized messages decide | 1, 5, 10, 11 |
| §4.3 event mapping, mapper copies and snapshot, tool completion from the saved result, `item/removed` | 11 (`model_select` via the bridge extension) |
| §4.4 Phase A methods (start dispositions, payload/read, snapshot/cursor, idle steer/follow-up) | 1, 7-13 |
| §4.5 sidebar vs subscriber notifications, resume snapshot in one tick, request routing and withdrawal on unsubscribe, replacement order | 7 (commit on send), 9, 11, 12, 13 |
| §5.2 shared vs per thread, owned routes, providers, discovery, built-ins, project trust | 4, 8, 9, 14 |
| §5.3 leased bounded cache, module/provider docs and retained memory | 5, 15 |
| §5.4 approvals, ordering, persisted effective mode, fail-closed restore | 12 |
| §5.5 lock contract, write-path inventory, `forkFrom` locks first, guarded exit cleanup and refresh, read-only reads, closed managers, compromise recovery, terminal fork offer | 2, 3, 11 (lost lock unloads) |
| §5.6 lifecycle states, one load path, transitions wait for loads, whole-operation tracking, thread queue, busy, idle unload, preflight cancellation through commands, shutdown, EOF answers accepted requests | 7, 9, 10, 11, 14 |
| §5.7 turns | 11 |
| §5.8 both-path archive ownership, no-replace publication, header-id lookup | 9, 10 |
| §5.9 byte limits, payloads/chunks, bounded pages and snapshots, drain/abort, EOF | 1, 6, 7, 10, 11, 14 |
| §10 Phase A manifest: `"desktop"` mode and built-in branches, `output-guard.ts` | 5, 14 |
| §10 docs (app-server/schema/extensions/cli/sessions/session-format/sdk), public errors, changesets | 1, 3, 5, 15 |
| §11 Phase A tests | 1-14 |
| §13 listing cost, loaded/unloaded memory, repeated-project retention | 5, 10, 14, 15 |

### Implementation-risk review coverage

| Finding | Resolution / owning task |
| --- | --- |
| 1. Symlink locking bypass | canonical binding and two-process alias/hard-link tests — 2 |
| 2. Replacement aborts forwarded prompt | mutable owner and target reservation before disposal — 11, 13 |
| 3. Archive overwrites/unlocks destination | both locks, no-replace link/unlink, collision/failure tests — 10 |
| 4. Failed switch leaves writable unlocked manager | close after post-bind failure; retain old on acquisition refusal — 2 |
| 5. Mapper order and historical call status | removal before id reuse; explicit active id/unresolved-result tracking — 10, 11 |
| 6. Unstable cursor/missing running snapshot | anchored prefix plus independent current snapshot — 1, 10, 11 |
| 7. Transcript exceeds output budget | byte-aware pages, immutable refs/chunks, lean completion — 1, 10, 11, 12 |
| 8. Empty start response hides disposition | first explicit outcome, effective thread and token — 1, 11, 13 |
| 9. Listing not lightweight | document initial scan, bounded immutable continuation cache, benchmarks — 10, 15 |
| 10. Git preflight falsely guarantees rollback | corrected architecture §6.1 and Phase B hook/race/recovery tests; not Phase A code |
| Additional: memory/cache retention | leased 256-inactive-entry cache, cleanup, 100-cycle measurements — 5, 10, 15 |
| Additional: session/format/SDK docs and errors | doc manifest/examples/public-export regression — 15 |
| Additional: error.data dropped | exact client propagation and regression — 7 |

Not in Phase A, by the spec: worktrees, diffs, git, `turn/diff/updated` (Phase B, §6, including the handoff and change-detection rules revised in the design review, and the third review's fixes: branches named `kc/<threadId>` with the whole id, `baseRef` stored as the commit SHA resolved at creation, and `turn/diff/updated` documented as "files that changed while the turn ran" rather than per-turn attribution); `ui/*`, views, `hasUI` true for desktop (Phase C); the terminal on the protocol and local handles (Phase D).
