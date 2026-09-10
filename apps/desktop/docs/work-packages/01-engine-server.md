# WP01 — Engine server

Status: planned, not yet implemented
Date: 2026-09-11
Revision: 1

Implement this plan task by task, in order. Each task carries its own test
cycle; do not start the next until the current one's tests pass and
`bun run check-types` is clean. Steps use checkbox (`- [ ]`) syntax for
tracking.

**Goal:** Ship `knightcode-engine`, a headless local HTTP server that owns
credentials, models, and inference for the KnightCode IDE, driven end to end by
`curl` with no IDE present.

**Architecture:** A `node:http` server bound to `127.0.0.1` on an ephemeral
port, guarded by a launch token passed in the environment. It wraps the existing
`ModelRuntime` from `packages/cli/src/core/model-runtime.ts`, backed by a new
`CredentialStore` that stores secrets in the OS keychain via `Bun.secrets`.
Chat and FIM endpoints are OpenAI-shaped so the Rust side can reuse Zed's
existing OpenAI-compatible client shapes; the engine translates to and from
`Context` and `AssistantMessageEvent` internally.

**Tech Stack:** TypeScript, Bun, `node:http`, `node:crypto`, `Bun.secrets`,
Vitest, the faux provider in `packages/ai/src/providers/faux.ts`.

**Spec:** `apps/desktop/docs/architecture.md` — §5 Engine HTTP surface, §6
Credentials and sign-in, §7 Engine lifecycle, §10 Phase A, §11 Required tests.

## Global Constraints

Copied verbatim from `AGENTS.md` and the spec. Every task's requirements
implicitly include this section.

- Formatting is Prettier: tabs, 120 columns, LF. Run `bun run format`.
- No `any` unless absolutely necessary.
- **No inline imports** (`await import()`, `import("pkg").Type`). Top-level
  imports only.
- `erasableSyntaxOnly` is set: no parameter properties, `enum`, `namespace`,
  `import =`, `export =`. Use explicit fields with constructor assignments.
- Code must work on Windows as well as POSIX.
- Never edit `packages/ai/src/models.generated.ts` directly.
- After code changes: `bun run check-types` from the repo root, full output.
  Fix every error before committing.
- Tests run from `packages/cli` with `bun x vitest --run test/engine/<file>`.
- No real provider APIs, keys, or paid tokens. Use the faux provider.
- The engine's system prompt and tool definitions stay the CLI's, unchanged.
  The ~1,100-token floor binds the engine identically.
- No response body on any route may contain a token, API key, or refresh token.
- Do not commit unless the user asks. Steps that say "Commit" prepare the
  commit; ask before running it.

---

## 0. Mandatory reading

Read completely before starting Task 1.

1. `apps/desktop/docs/architecture.md` — the whole document.
2. `packages/ai/src/auth/types.ts` — `CredentialStore`, `Credential`,
   `CredentialInfo`, `AuthInteraction`, `AuthPrompt`, `AuthEvent`,
   `ProviderAuth`.
3. `packages/cli/src/core/auth-storage.ts` — `AuthStorage.create()`, the
   file-backed store reused as the Linux fallback.
4. `packages/cli/src/core/model-runtime.ts` lines 55–200 and 396–700 —
   `ModelRuntime.create()`, `getAvailable`, `checkAuth`, `login`, `logout`,
   `stream`.
5. `packages/ai/src/models.ts` lines 97–230 — `Provider` and `Models`.
6. `packages/ai/src/types.ts` lines 429–563 and 846+ — `AssistantMessage`,
   `Context`, `AssistantMessageEvent`, `Model`.
7. `packages/ai/src/providers/faux.ts` — `fauxProvider`, `fauxText`,
   `fauxAssistantMessage`.
8. `packages/cli/test/auth-storage.test.ts` — test conventions in this package.
9. `packages/cli/src/bun/cli.ts` and `scripts/build.ts` — how a Bun-only entry
   is registered and compiled.

---

## File structure

```text
packages/cli/src/engine-entry.ts        binary entrypoint; env, port line
packages/cli/src/engine/server.ts       http listener, host + token guard, router
packages/cli/src/engine/context.ts      EngineContext, wiring, shutdown
packages/cli/src/engine/events.ts       EventBus + GET /events
packages/cli/src/engine/secrets.ts      SecretBackend interface, index file
packages/cli/src/bun/secrets.ts         Bun.secrets backend (Bun-only)
packages/cli/src/engine/keychain-store.ts  KeychainCredentialStore
packages/cli/src/engine/accounts.ts     GET/DELETE /v1/accounts, login routes
packages/cli/src/engine/models.ts       GET /v1/models
packages/cli/src/engine/openai.ts       OpenAI <-> Context translation, pure
packages/cli/src/engine/completions.ts  POST /v1/chat/completions, /v1/completions

packages/cli/test/engine/server.test.ts
packages/cli/test/engine/events.test.ts
packages/cli/test/engine/keychain-store.test.ts
packages/cli/test/engine/accounts.test.ts
packages/cli/test/engine/models.test.ts
packages/cli/test/engine/openai.test.ts
packages/cli/test/engine/completions.test.ts
```

`openai.ts` is pure translation with no I/O so it can be unit tested without a
server. `secrets.ts` holds the interface and the non-secret index; the
`Bun.secrets` implementation lives under `src/bun/` because that directory is
already where Bun-only registrations go, and Vitest runs under Node where
`Bun.secrets` does not exist.

---

## Task 1: HTTP server, host and token guard

**Files:**
- Create: `packages/cli/src/engine/server.ts`
- Test: `packages/cli/test/engine/server.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface EngineRoute { method: string; path: string; handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> | void }`
  - `export interface EngineServer { port: number; close(): Promise<void> }`
  - `export interface StartEngineServerOptions { token: string; routes: readonly EngineRoute[]; host?: string }`
  - `export function startEngineServer(options: StartEngineServerOptions): Promise<EngineServer>`
  - `export function sendJson(res: ServerResponse, status: number, body: unknown): void`

`/health` is served by the guard itself and needs no route entry: it is the only
unauthenticated path, and the IDE polls it before it can prove anything.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/server.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

describe("engine server", () => {
	let server: EngineServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	async function start(token = "test-token"): Promise<string> {
		server = await startEngineServer({
			token,
			routes: [
				{
					method: "GET",
					path: "/v1/ping",
					handle: (_req, res) => {
						res.writeHead(200, { "content-type": "application/json" });
						res.end(JSON.stringify({ ok: true }));
					},
				},
			],
		});
		return `http://127.0.0.1:${server.port}`;
	}

	test("binds an ephemeral loopback port", async () => {
		const base = await start();
		expect(server?.port).toBeGreaterThan(0);
		expect(base).toContain("127.0.0.1");
	});

	test("serves /health without a token", async () => {
		const base = await start();
		const res = await fetch(`${base}/health`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	test("rejects a missing token", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/ping`);
		expect(res.status).toBe(401);
	});

	test("rejects a wrong token", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/ping`, { headers: { authorization: "Bearer nope" } });
		expect(res.status).toBe(401);
	});

	test("rejects a token of a different length without leaking timing", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/ping`, { headers: { authorization: "Bearer short" } });
		expect(res.status).toBe(401);
	});

	test("accepts the correct token", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/ping`, { headers: { authorization: "Bearer test-token" } });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	test("rejects a non-loopback Host header", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/ping`, {
			headers: { authorization: "Bearer test-token", host: "evil.example.com" },
		});
		expect(res.status).toBe(403);
	});

	test("returns 404 for an unknown authenticated path", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/nothing`, { headers: { authorization: "Bearer test-token" } });
		expect(res.status).toBe(404);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/server.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/server.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/server.ts
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface EngineRoute {
	method: string;
	path: string;
	handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> | void;
}

export interface EngineServer {
	port: number;
	close(): Promise<void>;
}

export interface StartEngineServerOptions {
	token: string;
	routes: readonly EngineRoute[];
	host?: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
	res.end(payload);
}

/** Constant-time compare that does not reveal length through an early return. */
function tokenMatches(presented: string, expected: string): boolean {
	const a = Buffer.from(presented, "utf8");
	const b = Buffer.from(expected, "utf8");
	const width = Math.max(a.length, b.length);
	const padded = (buffer: Buffer) => {
		const out = Buffer.alloc(width);
		buffer.copy(out);
		return out;
	};
	return timingSafeEqual(padded(a), padded(b)) && a.length === b.length;
}

function hostIsLoopback(header: string | undefined): boolean {
	if (!header) return false;
	const withoutPort = header.startsWith("[") ? header.slice(0, header.indexOf("]") + 1) : header.split(":")[0];
	return LOOPBACK_HOSTS.has(withoutPort);
}

function bearerToken(header: string | undefined): string | undefined {
	if (!header) return undefined;
	const [scheme, ...rest] = header.split(" ");
	if (scheme.toLowerCase() !== "bearer") return undefined;
	const value = rest.join(" ").trim();
	return value.length > 0 ? value : undefined;
}

export function startEngineServer(options: StartEngineServerOptions): Promise<EngineServer> {
	const host = options.host ?? "127.0.0.1";
	const server: Server = createServer((req, res) => {
		void handle(req, res);
	});

	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${host}`);

		if (req.method === "GET" && url.pathname === "/health") {
			sendJson(res, 200, { status: "ok" });
			return;
		}

		if (!hostIsLoopback(req.headers.host)) {
			sendJson(res, 403, { error: "forbidden" });
			return;
		}

		const presented = bearerToken(req.headers.authorization);
		if (!presented || !tokenMatches(presented, options.token)) {
			sendJson(res, 401, { error: "unauthorized" });
			return;
		}

		const route = options.routes.find((entry) => entry.method === req.method && entry.path === url.pathname);
		if (!route) {
			sendJson(res, 404, { error: "not_found" });
			return;
		}

		try {
			await route.handle(req, res, url);
		} catch (error) {
			if (!res.headersSent) sendJson(res, 500, { error: "internal", message: String(error) });
			else res.end();
		}
	}

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, host, () => {
			const address = server.address() as AddressInfo;
			resolve({
				port: address.port,
				close: () =>
					new Promise<void>((done, fail) => {
						server.close((error) => (error ? fail(error) : done()));
					}),
			});
		});
	});
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/server.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Type check and commit**

```bash
bun run check-types
git add packages/cli/src/engine/server.ts packages/cli/test/engine/server.test.ts
git commit -m "feat(engine): add loopback http server with host and token guards"
```

---

## Task 2: Event bus and GET /events

**Files:**
- Create: `packages/cli/src/engine/events.ts`
- Test: `packages/cli/test/engine/events.test.ts`

**Interfaces:**
- Consumes: `EngineRoute`, `startEngineServer` from Task 1.
- Produces:
  - `export type EngineEvent = { type: "account.changed"; providerId: string; authenticated: boolean } | { type: "models.changed" }`
  - `export interface EventBus { publish(event: EngineEvent): void; subscribe(listener: (event: EngineEvent) => void): () => void; subscriberCount(): number }`
  - `export function createEventBus(): EventBus`
  - `export function eventsRoute(bus: EventBus, heartbeatMs?: number): EngineRoute`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/events.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { createEventBus, eventsRoute } from "../../src/engine/events.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

describe("event bus", () => {
	test("delivers to every subscriber and stops after unsubscribe", () => {
		const bus = createEventBus();
		const seen: string[] = [];
		const stop = bus.subscribe((event) => seen.push(event.type));
		bus.publish({ type: "models.changed" });
		expect(seen).toEqual(["models.changed"]);
		stop();
		bus.publish({ type: "models.changed" });
		expect(seen).toEqual(["models.changed"]);
		expect(bus.subscriberCount()).toBe(0);
	});

	test("one failing subscriber does not stop the others", () => {
		const bus = createEventBus();
		const seen: string[] = [];
		bus.subscribe(() => {
			throw new Error("boom");
		});
		bus.subscribe((event) => seen.push(event.type));
		bus.publish({ type: "models.changed" });
		expect(seen).toEqual(["models.changed"]);
	});
});

describe("GET /events", () => {
	let server: EngineServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	test("streams published events as SSE and drops the subscriber on disconnect", async () => {
		const bus = createEventBus();
		server = await startEngineServer({ token: "t", routes: [eventsRoute(bus, 50)] });
		const controller = new AbortController();
		const res = await fetch(`http://127.0.0.1:${server.port}/events`, {
			headers: { authorization: "Bearer t" },
			signal: controller.signal,
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/event-stream");

		const reader = res.body!.getReader();
		const decoder = new TextDecoder();
		bus.publish({ type: "account.changed", providerId: "anthropic", authenticated: true });

		let buffer = "";
		while (!buffer.includes("account.changed")) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
		}
		expect(buffer).toContain('"providerId":"anthropic"');

		controller.abort();
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(bus.subscriberCount()).toBe(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/events.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/events.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/events.ts
import type { EngineRoute } from "./server.ts";

export type EngineEvent =
	| { type: "account.changed"; providerId: string; authenticated: boolean }
	| { type: "models.changed" };

export interface EventBus {
	publish(event: EngineEvent): void;
	subscribe(listener: (event: EngineEvent) => void): () => void;
	subscriberCount(): number;
}

export function createEventBus(): EventBus {
	const listeners = new Set<(event: EngineEvent) => void>();
	return {
		publish(event) {
			for (const listener of [...listeners]) {
				try {
					listener(event);
				} catch {
					// A broken subscriber must not stop delivery to the rest.
				}
			}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		subscriberCount: () => listeners.size,
	};
}

export function eventsRoute(bus: EventBus, heartbeatMs = 15_000): EngineRoute {
	return {
		method: "GET",
		path: "/events",
		handle: (req, res) => {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
				"x-accel-buffering": "no",
				"x-content-type-options": "nosniff",
			});
			res.write(": connected\n\n");

			const unsubscribe = bus.subscribe((event) => {
				res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
			});
			const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), heartbeatMs);
			heartbeat.unref?.();

			const stop = () => {
				clearInterval(heartbeat);
				unsubscribe();
			};
			req.on("close", stop);
			req.on("error", stop);
		},
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/events.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Type check and commit**

```bash
bun run check-types
git add packages/cli/src/engine/events.ts packages/cli/test/engine/events.test.ts
git commit -m "feat(engine): add event bus and SSE /events route"
```

---

## Task 3: Secret backend and the non-secret account index

**Files:**
- Create: `packages/cli/src/engine/secrets.ts`
- Create: `packages/cli/src/bun/secrets.ts`
- Test: covered by Task 4's tests; `secrets.ts` has no branching logic of its own
  beyond the index, which Task 4 exercises through the store.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface SecretBackend { get(name: string): Promise<string | null>; set(name: string, value: string): Promise<void>; delete(name: string): Promise<void> }`
  - `export interface AccountIndexEntry { providerId: string; type: "api_key" | "oauth" }`
  - `export interface AccountIndex { read(): Promise<readonly AccountIndexEntry[]>; write(entries: readonly AccountIndexEntry[]): Promise<void> }`
  - `export function createFileAccountIndex(path: string): AccountIndex`
  - `export function createMemorySecretBackend(): SecretBackend` — test double
  - From `src/bun/secrets.ts`: `export function createBunSecretBackend(service?: string): SecretBackend`

`Bun.secrets` exposes only `get`, `set` and `delete` — there is no enumeration.
The index therefore records which providers have a stored credential and of
what type. It holds no secret material, which is also what makes
`GET /v1/accounts` answerable without touching the keychain at all.

- [ ] **Step 1: Write the implementation**

This task has no test of its own; it is two definitions and a test double. Its
behaviour is gated by Task 4, which is where a reviewer can meaningfully accept
or reject it.

```ts
// packages/cli/src/engine/secrets.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SecretBackend {
	get(name: string): Promise<string | null>;
	set(name: string, value: string): Promise<void>;
	delete(name: string): Promise<void>;
}

export interface AccountIndexEntry {
	providerId: string;
	type: "api_key" | "oauth";
}

export interface AccountIndex {
	read(): Promise<readonly AccountIndexEntry[]>;
	write(entries: readonly AccountIndexEntry[]): Promise<void>;
}

export function createFileAccountIndex(path: string): AccountIndex {
	return {
		async read() {
			try {
				const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
				if (!Array.isArray(parsed)) return [];
				return parsed.filter(
					(entry): entry is AccountIndexEntry =>
						typeof entry === "object" &&
						entry !== null &&
						typeof (entry as AccountIndexEntry).providerId === "string" &&
						((entry as AccountIndexEntry).type === "api_key" || (entry as AccountIndexEntry).type === "oauth"),
				);
			} catch {
				return [];
			}
		},
		async write(entries) {
			mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
			writeFileSync(path, JSON.stringify(entries), { encoding: "utf-8", mode: 0o600 });
		},
	};
}

export function createMemorySecretBackend(): SecretBackend {
	const store = new Map<string, string>();
	return {
		async get(name) {
			return store.get(name) ?? null;
		},
		async set(name, value) {
			store.set(name, value);
		},
		async delete(name) {
			store.delete(name);
		},
	};
}
```

```ts
// packages/cli/src/bun/secrets.ts
import type { SecretBackend } from "../engine/secrets.ts";

/**
 * OS keychain backend. Bun.secrets maps to Keychain Services on macOS, the
 * Windows Credential Manager, and libsecret on Linux. Bun-only: Vitest runs
 * under Node, where this module is never loaded.
 */
export function createBunSecretBackend(service = "knightcode"): SecretBackend {
	return {
		get: (name) => Bun.secrets.get({ service, name }),
		set: (name, value) => Bun.secrets.set({ service, name, value }),
		delete: async (name) => {
			await Bun.secrets.delete({ service, name });
		},
	};
}
```

- [ ] **Step 2: Type check**

Run: `bun run check-types`
Expected: no errors. If `Bun.secrets` is unknown to the type checker, confirm
`@types/bun` is current rather than adding a cast.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/engine/secrets.ts packages/cli/src/bun/secrets.ts
git commit -m "feat(engine): add secret backend interface and keychain implementation"
```

---

## Task 4: KeychainCredentialStore

**Files:**
- Create: `packages/cli/src/engine/keychain-store.ts`
- Test: `packages/cli/test/engine/keychain-store.test.ts`

**Interfaces:**
- Consumes: `SecretBackend`, `AccountIndex`, `createMemorySecretBackend`,
  `createFileAccountIndex` from Task 3.
- Produces:
  - `export interface KeychainCredentialStoreOptions { backend: SecretBackend; index: AccountIndex }`
  - `export class KeychainCredentialStore implements CredentialStore` with
    `read`, `list`, `modify`, `delete` exactly as declared in
    `packages/ai/src/auth/types.ts:65`.
  - `export function createEngineCredentialStore(options: { backend?: SecretBackend; index?: AccountIndex; fallbackAuthPath?: string }): CredentialStore`

`modify` must serialize per provider id: `Models.getAuth()` runs OAuth refresh
inside `modify`, so two concurrent requests to the same provider must not both
refresh a rotated token. An indexed provider whose secret has vanished — a crash
between the two writes — reads as `undefined` and is dropped from the index on
the next `list`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/keychain-store.test.ts
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { KeychainCredentialStore } from "../../src/engine/keychain-store.ts";
import { createFileAccountIndex, createMemorySecretBackend } from "../../src/engine/secrets.ts";

describe("KeychainCredentialStore", () => {
	const tempDir = join(tmpdir(), `knightcode-test-keychain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const indexPath = join(tempDir, "engine-accounts.json");

	beforeEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	function createStore() {
		const backend = createMemorySecretBackend();
		const store = new KeychainCredentialStore({ backend, index: createFileAccountIndex(indexPath) });
		return { backend, store };
	}

	test("read returns undefined for an unknown provider", async () => {
		const { store } = createStore();
		expect(await store.read("anthropic")).toBeUndefined();
	});

	test("modify persists a credential that read returns", async () => {
		const { store } = createStore();
		const written = await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-test" }));
		expect(written).toEqual({ type: "api_key", key: "sk-test" });
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "sk-test" });
	});

	test("modify sees the current credential", async () => {
		const { store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "first" }));
		const seen: (string | undefined)[] = [];
		await store.modify("anthropic", async (current) => {
			seen.push(current?.type === "api_key" ? current.key : undefined);
			return { type: "api_key", key: "second" };
		});
		expect(seen).toEqual(["first"]);
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "second" });
	});

	test("modify returning undefined leaves the entry unchanged", async () => {
		const { store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "keep" }));
		await store.modify("anthropic", async () => undefined);
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "keep" });
	});

	test("concurrent modify calls on one provider serialize", async () => {
		const { store } = createStore();
		const order: string[] = [];
		const slow = store.modify("anthropic", async () => {
			order.push("a:start");
			await new Promise((resolve) => setTimeout(resolve, 30));
			order.push("a:end");
			return { type: "api_key", key: "a" };
		});
		const fast = store.modify("anthropic", async (current) => {
			order.push(`b:start:${current?.type === "api_key" ? current.key : "none"}`);
			return { type: "api_key", key: "b" };
		});
		await Promise.all([slow, fast]);
		expect(order).toEqual(["a:start", "a:end", "b:start:a"]);
		expect(await store.read("anthropic")).toEqual({ type: "api_key", key: "b" });
	});

	test("list reports metadata without secrets", async () => {
		const { store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-test" }));
		await store.modify("openai", async () => ({
			type: "oauth",
			refresh: "r",
			access: "a",
			expires: Date.now() + 60_000,
		}));
		const listed = await store.list();
		expect([...listed].sort((a, b) => a.providerId.localeCompare(b.providerId))).toEqual([
			{ providerId: "anthropic", type: "api_key" },
			{ providerId: "openai", type: "oauth" },
		]);
		expect(JSON.stringify(listed)).not.toContain("sk-test");
	});

	test("delete removes the secret and the index entry", async () => {
		const { backend, store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-test" }));
		await store.delete("anthropic");
		expect(await store.read("anthropic")).toBeUndefined();
		expect(await store.list()).toEqual([]);
		expect(await backend.get("provider:anthropic")).toBeNull();
	});

	test("an indexed provider with no stored secret is dropped from list", async () => {
		const { backend, store } = createStore();
		await store.modify("anthropic", async () => ({ type: "api_key", key: "sk-test" }));
		await backend.delete("provider:anthropic");
		expect(await store.read("anthropic")).toBeUndefined();
		expect(await store.list()).toEqual([]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/keychain-store.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/keychain-store.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/keychain-store.ts
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@knightcode/ai";
import { AuthStorage } from "../core/auth-storage.ts";
import { type AccountIndex, type AccountIndexEntry, createFileAccountIndex, type SecretBackend } from "./secrets.ts";

export interface KeychainCredentialStoreOptions {
	backend: SecretBackend;
	index: AccountIndex;
}

function secretName(providerId: string): string {
	return `provider:${providerId}`;
}

export class KeychainCredentialStore implements CredentialStore {
	private readonly backend: SecretBackend;
	private readonly index: AccountIndex;
	private readonly operations = new Map<string, Promise<unknown>>();

	constructor(options: KeychainCredentialStoreOptions) {
		this.backend = options.backend;
		this.index = options.index;
	}

	/** Serialize every write for one provider id onto a single chain. */
	private enqueue<T>(providerId: string, fn: () => Promise<T>): Promise<T> {
		const previous = this.operations.get(providerId) ?? Promise.resolve();
		const next = previous.then(fn, fn);
		this.operations.set(
			providerId,
			next.catch(() => undefined),
		);
		return next;
	}

	async read(providerId: string): Promise<Credential | undefined> {
		const raw = await this.backend.get(secretName(providerId));
		if (raw === null) return undefined;
		try {
			return JSON.parse(raw) as Credential;
		} catch {
			return undefined;
		}
	}

	async list(): Promise<readonly CredentialInfo[]> {
		const entries = await this.index.read();
		const present: AccountIndexEntry[] = [];
		for (const entry of entries) {
			const credential = await this.read(entry.providerId);
			if (credential) present.push({ providerId: entry.providerId, type: credential.type });
		}
		if (present.length !== entries.length) await this.index.write(present);
		return present.map((entry) => ({ providerId: entry.providerId, type: entry.type }));
	}

	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		_options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		return this.enqueue(providerId, async () => {
			const current = await this.read(providerId);
			const next = await fn(current);
			if (next === undefined) return current;
			await this.backend.set(secretName(providerId), JSON.stringify(next));
			const entries = (await this.index.read()).filter((entry) => entry.providerId !== providerId);
			await this.index.write([...entries, { providerId, type: next.type }]);
			return next;
		});
	}

	delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
		return this.enqueue(providerId, async () => {
			const entries = (await this.index.read()).filter((entry) => entry.providerId !== providerId);
			await this.index.write(entries);
			await this.backend.delete(secretName(providerId));
		});
	}
}

export function createEngineCredentialStore(options: {
	backend?: SecretBackend;
	index?: AccountIndex;
	indexPath?: string;
	fallbackAuthPath?: string;
}): CredentialStore {
	if (!options.backend) {
		// No keychain on this machine: fall back to the CLI's file store, which
		// already writes at 0600 and holds a cross-process lock. Silently
		// degrading a secret store is not acceptable; the caller reports it.
		return AuthStorage.create(options.fallbackAuthPath);
	}
	const index = options.index ?? createFileAccountIndex(options.indexPath ?? "engine-accounts.json");
	return new KeychainCredentialStore({ backend: options.backend, index });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/keychain-store.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Type check and commit**

```bash
bun run check-types
git add packages/cli/src/engine/keychain-store.ts packages/cli/test/engine/keychain-store.test.ts
git commit -m "feat(engine): add keychain-backed credential store"
```

---

## Task 5: EngineContext wiring

**Files:**
- Create: `packages/cli/src/engine/context.ts`
- Test: exercised by Tasks 6–9; this task defines the shared object those routes
  receive and has no behaviour a reviewer could reject independently of them.

**Interfaces:**
- Consumes: `EventBus` (Task 2), `createEngineCredentialStore` (Task 4).
- Produces:
  - `export interface EngineContext { models: ModelRuntime; credentials: CredentialStore; events: EventBus; keychainAvailable: boolean }`
  - `export interface CreateEngineContextOptions { credentials?: CredentialStore; backend?: SecretBackend; indexPath?: string; fallbackAuthPath?: string; events?: EventBus; allowModelNetwork?: boolean }`
  - `export function createEngineContext(options?: CreateEngineContextOptions): Promise<EngineContext>`

- [ ] **Step 1: Write the implementation**

```ts
// packages/cli/src/engine/context.ts
import type { CredentialStore } from "@knightcode/ai";
import { ModelRuntime } from "../core/model-runtime.ts";
import { createEventBus, type EventBus } from "./events.ts";
import { createEngineCredentialStore } from "./keychain-store.ts";
import type { SecretBackend } from "./secrets.ts";

export interface EngineContext {
	models: ModelRuntime;
	credentials: CredentialStore;
	events: EventBus;
	keychainAvailable: boolean;
}

export interface CreateEngineContextOptions {
	credentials?: CredentialStore;
	backend?: SecretBackend;
	indexPath?: string;
	fallbackAuthPath?: string;
	events?: EventBus;
	allowModelNetwork?: boolean;
}

export async function createEngineContext(options: CreateEngineContextOptions = {}): Promise<EngineContext> {
	const credentials =
		options.credentials ??
		createEngineCredentialStore({
			backend: options.backend,
			indexPath: options.indexPath,
			fallbackAuthPath: options.fallbackAuthPath,
		});
	const models = await ModelRuntime.create({
		credentials,
		allowModelNetwork: options.allowModelNetwork ?? false,
	});
	return {
		models,
		credentials,
		events: options.events ?? createEventBus(),
		keychainAvailable: options.backend !== undefined,
	};
}
```

- [ ] **Step 2: Type check and commit**

```bash
bun run check-types
git add packages/cli/src/engine/context.ts
git commit -m "feat(engine): add engine context wiring"
```

---

## Task 6: GET /v1/accounts and DELETE /v1/accounts/:providerId

**Files:**
- Create: `packages/cli/src/engine/accounts.ts`
- Test: `packages/cli/test/engine/accounts.test.ts`

**Interfaces:**
- Consumes: `EngineContext` (Task 5), `EngineRoute`, `sendJson` (Task 1).
- Produces:
  - `export interface AccountSummary { providerId: string; providerName: string; type: "api_key" | "oauth"; isSubscription: boolean }`
  - `export interface LoginOption { providerId: string; providerName: string; type: "api_key" | "oauth"; label: string; isSubscription: boolean }`
  - `export function accountsRoutes(ctx: EngineContext): readonly EngineRoute[]`

Route matching in Task 1 is exact-path. `DELETE /v1/accounts/:providerId`
therefore registers as a prefix-aware route by matching `/v1/accounts` on
`DELETE` and reading the id from a `providerId` query parameter is *not*
acceptable — extend the router instead. Add to `server.ts`:

```ts
export interface EngineRoute {
	method: string;
	path: string;
	/** When true, `path` matches as a prefix and the remainder is passed to handle(). */
	prefix?: boolean;
	handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> | void;
}
```

and change the lookup in `startEngineServer` to:

```ts
const route = options.routes.find((entry) =>
	entry.method === req.method &&
	(entry.prefix ? url.pathname.startsWith(`${entry.path}/`) : entry.path === url.pathname),
);
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/accounts.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { accountsRoutes } from "../../src/engine/accounts.ts";
import { createEngineContext } from "../../src/engine/context.ts";
import { createEventBus } from "../../src/engine/events.ts";
import { createFileAccountIndex, createMemorySecretBackend } from "../../src/engine/secrets.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("accounts routes", () => {
	let server: EngineServer | undefined;
	const tempDir = join(tmpdir(), `knightcode-test-accounts-${Date.now()}-${Math.random().toString(36).slice(2)}`);

	afterEach(async () => {
		await server?.close();
		server = undefined;
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	async function start() {
		mkdirSync(tempDir, { recursive: true });
		const backend = createMemorySecretBackend();
		const events = createEventBus();
		const ctx = await createEngineContext({
			backend,
			indexPath: join(tempDir, "engine-accounts.json"),
			events,
		});
		server = await startEngineServer({ token: "t", routes: accountsRoutes(ctx) });
		return { base: `http://127.0.0.1:${server.port}`, ctx, events };
	}

	const auth = { authorization: "Bearer t" };

	test("lists no accounts before any login", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/accounts`, { headers: auth });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ accounts: [], loginOptions: expect.any(Array) });
	});

	test("login options name real providers and never contain a secret", async () => {
		const { base } = await start();
		const body = (await (await fetch(`${base}/v1/accounts`, { headers: auth })).json()) as {
			loginOptions: { providerId: string }[];
		};
		expect(body.loginOptions.some((option) => option.providerId === "anthropic")).toBe(true);
		expect(JSON.stringify(body)).not.toMatch(/sk-|refresh|access_token/);
	});

	test("lists a stored account as metadata only", async () => {
		const { base, ctx } = await start();
		await ctx.credentials.modify("anthropic", async () => ({ type: "api_key", key: "sk-secret" }));
		const body = (await (await fetch(`${base}/v1/accounts`, { headers: auth })).json()) as {
			accounts: { providerId: string; type: string }[];
		};
		expect(body.accounts).toEqual([
			expect.objectContaining({ providerId: "anthropic", type: "api_key" }),
		]);
		expect(JSON.stringify(body)).not.toContain("sk-secret");
	});

	test("delete removes the account and publishes account.changed", async () => {
		const { base, ctx, events } = await start();
		await ctx.credentials.modify("anthropic", async () => ({ type: "api_key", key: "sk-secret" }));
		const seen: unknown[] = [];
		events.subscribe((event) => seen.push(event));

		const res = await fetch(`${base}/v1/accounts/anthropic`, { method: "DELETE", headers: auth });
		expect(res.status).toBe(204);
		expect(await ctx.credentials.read("anthropic")).toBeUndefined();
		expect(seen).toContainEqual({ type: "account.changed", providerId: "anthropic", authenticated: false });
	});

	test("delete of an unknown provider is 404", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/accounts/not-a-provider`, { method: "DELETE", headers: auth });
		expect(res.status).toBe(404);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/accounts.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/accounts.ts`.

- [ ] **Step 3: Add `prefix` to the router, then write the implementation**

Apply the two `server.ts` edits shown in the Interfaces block above, then:

```ts
// packages/cli/src/engine/accounts.ts
import type { EngineContext } from "./context.ts";
import { type EngineRoute, sendJson } from "./server.ts";

export interface AccountSummary {
	providerId: string;
	providerName: string;
	type: "api_key" | "oauth";
	isSubscription: boolean;
}

export interface LoginOption {
	providerId: string;
	providerName: string;
	type: "api_key" | "oauth";
	label: string;
	isSubscription: boolean;
}

function loginOptions(ctx: EngineContext): LoginOption[] {
	const options: LoginOption[] = [];
	for (const provider of ctx.models.getProviders()) {
		const oauth = provider.auth.oauth;
		if (oauth) {
			options.push({
				providerId: provider.id,
				providerName: provider.name,
				type: "oauth",
				label: oauth.loginLabel ?? oauth.name,
				isSubscription: oauth.isSubscription === true,
			});
		}
		const apiKey = provider.auth.apiKey;
		if (apiKey?.login) {
			options.push({
				providerId: provider.id,
				providerName: provider.name,
				type: "api_key",
				label: apiKey.name,
				isSubscription: false,
			});
		}
	}
	return options;
}

export function accountsRoutes(ctx: EngineContext): readonly EngineRoute[] {
	return [
		{
			method: "GET",
			path: "/v1/accounts",
			handle: async (_req, res) => {
				const stored = await ctx.credentials.list();
				const accounts: AccountSummary[] = stored.map((entry) => {
					const provider = ctx.models.getProvider(entry.providerId);
					return {
						providerId: entry.providerId,
						providerName: provider?.name ?? entry.providerId,
						type: entry.type,
						isSubscription: entry.type === "oauth" && provider?.auth.oauth?.isSubscription === true,
					};
				});
				sendJson(res, 200, { accounts, loginOptions: loginOptions(ctx) });
			},
		},
		{
			method: "DELETE",
			path: "/v1/accounts",
			prefix: true,
			handle: async (_req, res, url) => {
				const providerId = decodeURIComponent(url.pathname.slice("/v1/accounts/".length));
				if (!ctx.models.getProvider(providerId)) {
					sendJson(res, 404, { error: "unknown_provider" });
					return;
				}
				await ctx.models.logout(providerId);
				ctx.events.publish({ type: "account.changed", providerId, authenticated: false });
				res.writeHead(204);
				res.end();
			},
		},
	];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun x vitest --run test/engine/accounts.test.ts test/engine/server.test.ts`
Expected: PASS. Task 1's suite must still pass after the router change.

- [ ] **Step 5: Type check and commit**

```bash
bun run check-types
git add packages/cli/src/engine/accounts.ts packages/cli/src/engine/server.ts packages/cli/test/engine/accounts.test.ts
git commit -m "feat(engine): add account listing and sign-out routes"
```

---

## Task 7: POST /v1/accounts/login and GET /v1/accounts/login/:id

**Files:**
- Modify: `packages/cli/src/engine/accounts.ts`
- Test: `packages/cli/test/engine/accounts.test.ts` (append a describe block)

**Interfaces:**
- Consumes: everything from Task 6, plus `AuthInteraction`, `AuthPrompt`,
  `AuthEvent` from `@knightcode/ai`.
- Produces:
  - `export type LoginState = { status: "pending"; loginId: string; events: AuthEvent[]; pendingPrompt?: { id: string; prompt: AuthPrompt } } | { status: "complete"; loginId: string; events: AuthEvent[] } | { status: "failed"; loginId: string; events: AuthEvent[]; error: string }`
  - `export interface LoginRegistry { start(providerId: string, type: "api_key" | "oauth"): Promise<{ loginId: string }>; get(loginId: string): LoginState | undefined; submit(loginId: string, value: string): boolean; cancel(loginId: string): void }`
  - `export function createLoginRegistry(ctx: EngineContext): LoginRegistry`
  - `accountsRoutes(ctx)` gains `POST /v1/accounts/login`,
    `GET /v1/accounts/login` (prefix, reads the id) and
    `POST /v1/accounts/login/:id/submit`.

The engine bridges `AuthInteraction` to HTTP: `notify()` appends to `events`,
which the IDE polls; `prompt()` parks a pending prompt and resolves when the IDE
posts a value. This is the whole reason `ProviderAuthInteraction` is injected
rather than assumed to be a terminal.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/cli/test/engine/accounts.test.ts
describe("login routes", () => {
	// start(), auth and server lifecycle are as defined in the describe block above;
	// duplicate the helper here rather than sharing state across describes.
	let server: EngineServer | undefined;
	const tempDir = join(tmpdir(), `knightcode-test-login-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const auth = { authorization: "Bearer t", "content-type": "application/json" };

	afterEach(async () => {
		await server?.close();
		server = undefined;
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	async function start() {
		mkdirSync(tempDir, { recursive: true });
		const ctx = await createEngineContext({
			backend: createMemorySecretBackend(),
			indexPath: join(tempDir, "engine-accounts.json"),
			events: createEventBus(),
		});
		server = await startEngineServer({ token: "t", routes: accountsRoutes(ctx) });
		return { base: `http://127.0.0.1:${server.port}`, ctx };
	}

	test("rejects a login for an unknown provider", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/accounts/login`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ providerId: "not-a-provider", type: "oauth" }),
		});
		expect(res.status).toBe(404);
	});

	test("rejects a login type the provider does not offer", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/accounts/login`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ providerId: "anthropic", type: "not-a-type" }),
		});
		expect(res.status).toBe(400);
	});

	test("an api-key login completes through prompt submission", async () => {
		const { base, ctx } = await start();
		const started = (await (
			await fetch(`${base}/v1/accounts/login`, {
				method: "POST",
				headers: auth,
				body: JSON.stringify({ providerId: "anthropic", type: "api_key" }),
			})
		).json()) as { loginId: string };
		expect(started.loginId).toBeTruthy();

		// Poll until the flow parks on its prompt for the key.
		let state = { status: "pending", pendingPrompt: undefined } as {
			status: string;
			pendingPrompt?: { id: string };
		};
		for (let attempt = 0; attempt < 50 && !state.pendingPrompt; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 20));
			state = (await (
				await fetch(`${base}/v1/accounts/login/${started.loginId}`, { headers: auth })
			).json()) as typeof state;
		}
		expect(state.pendingPrompt).toBeDefined();

		const submitted = await fetch(`${base}/v1/accounts/login/${started.loginId}/submit`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ value: "sk-entered" }),
		});
		expect(submitted.status).toBe(200);

		for (let attempt = 0; attempt < 50 && state.status === "pending"; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 20));
			state = (await (
				await fetch(`${base}/v1/accounts/login/${started.loginId}`, { headers: auth })
			).json()) as typeof state;
		}
		expect(state.status).toBe("complete");
		expect(await ctx.credentials.read("anthropic")).toMatchObject({ type: "api_key" });
	});

	test("login state never contains the entered secret", async () => {
		const { base } = await start();
		const started = (await (
			await fetch(`${base}/v1/accounts/login`, {
				method: "POST",
				headers: auth,
				body: JSON.stringify({ providerId: "anthropic", type: "api_key" }),
			})
		).json()) as { loginId: string };
		await new Promise((resolve) => setTimeout(resolve, 50));
		await fetch(`${base}/v1/accounts/login/${started.loginId}/submit`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ value: "sk-entered" }),
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		const raw = await (await fetch(`${base}/v1/accounts/login/${started.loginId}`, { headers: auth })).text();
		expect(raw).not.toContain("sk-entered");
	});

	test("an abandoned login can be cancelled", async () => {
		const { base } = await start();
		const started = (await (
			await fetch(`${base}/v1/accounts/login`, {
				method: "POST",
				headers: auth,
				body: JSON.stringify({ providerId: "anthropic", type: "api_key" }),
			})
		).json()) as { loginId: string };
		const cancelled = await fetch(`${base}/v1/accounts/login/${started.loginId}`, {
			method: "DELETE",
			headers: auth,
		});
		expect(cancelled.status).toBe(204);
		await new Promise((resolve) => setTimeout(resolve, 50));
		const state = (await (
			await fetch(`${base}/v1/accounts/login/${started.loginId}`, { headers: auth })
		).json()) as { status: string };
		expect(state.status).toBe("failed");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/accounts.test.ts`
Expected: FAIL — the login routes return 404.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/cli/src/engine/accounts.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { AuthEvent, AuthPrompt, AuthType } from "@knightcode/ai";

interface PendingPrompt {
	id: string;
	prompt: AuthPrompt;
	resolve(value: string): void;
	reject(error: Error): void;
}

interface LoginRecord {
	loginId: string;
	providerId: string;
	status: "pending" | "complete" | "failed";
	events: AuthEvent[];
	error?: string;
	pending?: PendingPrompt;
	controller: AbortController;
}

export type LoginState =
	| { status: "pending"; loginId: string; events: AuthEvent[]; pendingPrompt?: { id: string; prompt: AuthPrompt } }
	| { status: "complete"; loginId: string; events: AuthEvent[] }
	| { status: "failed"; loginId: string; events: AuthEvent[]; error: string };

export interface LoginRegistry {
	start(providerId: string, type: AuthType): Promise<{ loginId: string }>;
	get(loginId: string): LoginState | undefined;
	submit(loginId: string, value: string): boolean;
	cancel(loginId: string): void;
}

export function createLoginRegistry(ctx: EngineContext): LoginRegistry {
	const logins = new Map<string, LoginRecord>();

	return {
		async start(providerId, type) {
			const loginId = randomUUID();
			const record: LoginRecord = {
				loginId,
				providerId,
				status: "pending",
				events: [],
				controller: new AbortController(),
			};
			logins.set(loginId, record);

			const interaction = {
				signal: record.controller.signal,
				notify(event: AuthEvent) {
					record.events.push(event);
				},
				prompt(prompt: AuthPrompt) {
					return new Promise<string>((resolve, reject) => {
						record.pending = { id: randomUUID(), prompt, resolve, reject };
					});
				},
			};

			void ctx.models
				.login(providerId, type, interaction)
				.then(() => {
					record.status = "complete";
					record.pending = undefined;
					ctx.events.publish({ type: "account.changed", providerId, authenticated: true });
					ctx.events.publish({ type: "models.changed" });
				})
				.catch((error: unknown) => {
					record.status = "failed";
					record.pending = undefined;
					record.error = error instanceof Error ? error.message : String(error);
				});

			return { loginId };
		},

		get(loginId) {
			const record = logins.get(loginId);
			if (!record) return undefined;
			// `events` carries only auth_url / device_code / progress / info,
			// none of which hold entered secrets; the prompt is echoed without a value.
			if (record.status === "pending") {
				return {
					status: "pending",
					loginId,
					events: record.events,
					pendingPrompt: record.pending ? { id: record.pending.id, prompt: record.pending.prompt } : undefined,
				};
			}
			if (record.status === "complete") return { status: "complete", loginId, events: record.events };
			return { status: "failed", loginId, events: record.events, error: record.error ?? "login failed" };
		},

		submit(loginId, value) {
			const record = logins.get(loginId);
			if (!record?.pending) return false;
			const pending = record.pending;
			record.pending = undefined;
			pending.resolve(value);
			return true;
		},

		cancel(loginId) {
			const record = logins.get(loginId);
			if (!record) return;
			record.pending?.reject(new Error("login cancelled"));
			record.pending = undefined;
			record.controller.abort();
		},
	};
}
```

Then extend `accountsRoutes` to build one registry and add three routes:

Add `import type { IncomingMessage } from "node:http";` to `accounts.ts`, then:

```ts
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > 64 * 1024) throw new Error("body too large");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}
```

```ts
// inside accountsRoutes(ctx), before the returned array:
const registry = createLoginRegistry(ctx);

// added to the returned array:
{
	method: "POST",
	path: "/v1/accounts/login",
	handle: async (req, res) => {
		const body = await readJsonBody(req);
		const providerId = typeof body.providerId === "string" ? body.providerId : "";
		const type = body.type === "oauth" || body.type === "api_key" ? body.type : undefined;
		const provider = ctx.models.getProvider(providerId);
		if (!provider) {
			sendJson(res, 404, { error: "unknown_provider" });
			return;
		}
		if (!type || (type === "oauth" && !provider.auth.oauth) || (type === "api_key" && !provider.auth.apiKey?.login)) {
			sendJson(res, 400, { error: "unsupported_login_type" });
			return;
		}
		sendJson(res, 200, await registry.start(providerId, type));
	},
},
{
	method: "GET",
	path: "/v1/accounts/login",
	prefix: true,
	handle: (_req, res, url) => {
		const state = registry.get(url.pathname.slice("/v1/accounts/login/".length));
		if (!state) sendJson(res, 404, { error: "unknown_login" });
		else sendJson(res, 200, state);
	},
},
{
	method: "DELETE",
	path: "/v1/accounts/login",
	prefix: true,
	handle: (_req, res, url) => {
		registry.cancel(url.pathname.slice("/v1/accounts/login/".length));
		res.writeHead(204);
		res.end();
	},
},
{
	method: "POST",
	path: "/v1/accounts/login",
	prefix: true,
	handle: async (req, res, url) => {
		const rest = url.pathname.slice("/v1/accounts/login/".length);
		if (!rest.endsWith("/submit")) {
			sendJson(res, 404, { error: "not_found" });
			return;
		}
		const body = await readJsonBody(req);
		const value = typeof body.value === "string" ? body.value : "";
		if (!registry.submit(rest.slice(0, -"/submit".length), value)) {
			sendJson(res, 409, { error: "no_pending_prompt" });
			return;
		}
		sendJson(res, 200, { ok: true });
	},
},
```

Route order matters: the exact `POST /v1/accounts/login` entry must precede the
prefix entry, because Task 6's lookup returns the first match.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/cli && bun x vitest --run test/engine/accounts.test.ts`
Expected: PASS, 10 tests across both describe blocks.

- [ ] **Step 5: Type check and commit**

```bash
bun run check-types
git add packages/cli/src/engine/accounts.ts packages/cli/test/engine/accounts.test.ts
git commit -m "feat(engine): add login orchestration routes"
```

---

## Task 8: GET /v1/models

**Files:**
- Create: `packages/cli/src/engine/models.ts`
- Test: `packages/cli/test/engine/models.test.ts`

**Interfaces:**
- Consumes: `EngineContext` (Task 5), `EngineRoute`, `sendJson` (Task 1),
  `fauxProvider` from `@knightcode/ai`.
- Produces:
  - `export interface EngineModel { id: string; providerId: string; providerName: string; name: string; contextWindow: number; maxTokens: number; reasoning: boolean; input: readonly ("text" | "image")[]; cost: ModelCost }`
  - `export function modelsRoute(ctx: EngineContext): EngineRoute`

Field names verified against `Model<TApi>` at `packages/ai/src/types.ts:846`:
`id`, `name`, `provider`, `reasoning`, `input: ("text" | "image")[]`, `cost`,
`contextWindow`, `maxTokens`. Note `provider`, not `providerId`, on the source
type.

`GET /v1/models` is the only place the IDE learns what a model can do. The IDE
hardcodes no model list, so every field the model picker renders must appear
here.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/models.test.ts
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxProvider } from "@knightcode/ai";
import { afterEach, describe, expect, test } from "vitest";
import { createEngineContext } from "../../src/engine/context.ts";
import { modelsRoute } from "../../src/engine/models.ts";
import { createMemorySecretBackend } from "../../src/engine/secrets.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

describe("GET /v1/models", () => {
	let server: EngineServer | undefined;
	const tempDir = join(tmpdir(), `knightcode-test-models-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const auth = { authorization: "Bearer t" };

	afterEach(async () => {
		await server?.close();
		server = undefined;
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	async function start() {
		mkdirSync(tempDir, { recursive: true });
		const ctx = await createEngineContext({
			backend: createMemorySecretBackend(),
			indexPath: join(tempDir, "engine-accounts.json"),
		});
		server = await startEngineServer({ token: "t", routes: [modelsRoute(ctx)] });
		return { base: `http://127.0.0.1:${server.port}`, ctx };
	}

	test("returns no models when nothing is authenticated", async () => {
		const { base } = await start();
		const body = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as { models: unknown[] };
		expect(body.models).toEqual([]);
	});

	test("returns models for an authenticated provider with the fields the picker needs", async () => {
		const { base, ctx } = await start();
		const handle = fauxProvider();
		ctx.models.setProvider(handle.provider);
		await ctx.credentials.modify(handle.provider.id, async () => ({ type: "api_key", key: "faux-key" }));

		const body = (await (await fetch(`${base}/v1/models`, { headers: auth })).json()) as {
			models: { id: string; providerId: string; contextWindow: number; reasoning: boolean }[];
		};
		expect(body.models.length).toBeGreaterThan(0);
		const model = body.models[0];
		expect(model.providerId).toBe(handle.provider.id);
		expect(typeof model.contextWindow).toBe("number");
		expect(typeof model.reasoning).toBe("boolean");
	});

	test("never returns a credential", async () => {
		const { base, ctx } = await start();
		const handle = fauxProvider();
		ctx.models.setProvider(handle.provider);
		await ctx.credentials.modify(handle.provider.id, async () => ({ type: "api_key", key: "faux-secret-key" }));
		const raw = await (await fetch(`${base}/v1/models`, { headers: auth })).text();
		expect(raw).not.toContain("faux-secret-key");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/models.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/models.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/models.ts
import type { ModelCost } from "@knightcode/ai";
import type { EngineContext } from "./context.ts";
import { type EngineRoute, sendJson } from "./server.ts";

export interface EngineModel {
	id: string;
	providerId: string;
	providerName: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	input: readonly ("text" | "image")[];
	cost: ModelCost;
}

export function modelsRoute(ctx: EngineContext): EngineRoute {
	return {
		method: "GET",
		path: "/v1/models",
		handle: async (_req, res) => {
			const available = await ctx.models.getAvailable();
			const models: EngineModel[] = available.map((model) => ({
				id: model.id,
				providerId: model.provider,
				providerName: ctx.models.getProvider(model.provider)?.name ?? model.provider,
				name: model.name,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
			}));
			sendJson(res, 200, { models });
		},
	};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/models.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Type check and commit**

```bash
bun run check-types
git add packages/cli/src/engine/models.ts packages/cli/test/engine/models.test.ts
git commit -m "feat(engine): add model catalog route"
```

---

## Task 9: OpenAI translation

**Files:**
- Create: `packages/cli/src/engine/openai.ts`
- Test: `packages/cli/test/engine/openai.test.ts`

**Interfaces:**
- Consumes: `Context`, `Message`, `AssistantMessageEvent` from `@knightcode/ai`.
- Produces:
  - `export interface OpenAIChatRequest { model: string; messages: { role: "system" | "user" | "assistant"; content: string }[]; stream?: boolean; max_tokens?: number; temperature?: number }`
  - `export interface OpenAIChatChunk { id: string; object: "chat.completion.chunk"; created: number; model: string; choices: { index: 0; delta: { role?: "assistant"; content?: string }; finish_reason: string | null }[] }`
  - `export function parseChatRequest(body: unknown): OpenAIChatRequest`
  - `export function toContext(request: OpenAIChatRequest, model: Model<Api>): Context`
  - `export function toChunk(event: AssistantMessageEvent, id: string, model: string): OpenAIChatChunk | undefined`

`toContext` takes the resolved `Model` because `AssistantMessage`
(`packages/ai/src/types.ts:429`) requires `api`, `provider`, `model`, `usage`,
`stopReason` and `timestamp` — history turns cannot be constructed without it.
Passing the model is what keeps this module cast-free. `UserMessage.content`
accepts a bare `string` (`types.ts:425`), so user turns need no content array.

Pure functions, no I/O. This is the module a reviewer can check without running
a server, and the one most likely to be wrong.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/openai.test.ts
import { describe, expect, test } from "vitest";
import { parseChatRequest, toChunk, toContext } from "../../src/engine/openai.ts";

describe("parseChatRequest", () => {
	test("accepts a minimal request", () => {
		const parsed = parseChatRequest({ model: "m", messages: [{ role: "user", content: "hi" }] });
		expect(parsed.model).toBe("m");
		expect(parsed.messages).toEqual([{ role: "user", content: "hi" }]);
	});

	test("rejects a missing model", () => {
		expect(() => parseChatRequest({ messages: [] })).toThrow();
	});

	test("rejects messages that are not an array", () => {
		expect(() => parseChatRequest({ model: "m", messages: "nope" })).toThrow();
	});

	test("rejects an unknown role", () => {
		expect(() => parseChatRequest({ model: "m", messages: [{ role: "root", content: "x" }] })).toThrow();
	});
});

describe("toContext", () => {
	// A minimal Model literal; only the fields toContext reads are meaningful.
	const model = {
		id: "m",
		name: "M",
		api: "openai-completions",
		provider: "faux",
		baseUrl: "http://localhost",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	} as unknown as Parameters<typeof toContext>[1];

	test("lifts a leading system message into systemPrompt", () => {
		const context = toContext(
			{
				model: "m",
				messages: [
					{ role: "system", content: "be terse" },
					{ role: "user", content: "hi" },
				],
			},
			model,
		);
		expect(context.systemPrompt).toBe("be terse");
		expect(context.messages).toHaveLength(1);
		expect(context.messages[0]).toMatchObject({ role: "user", content: "hi" });
	});

	test("keeps assistant turns in order", () => {
		const context = toContext(
			{
				model: "m",
				messages: [
					{ role: "user", content: "one" },
					{ role: "assistant", content: "two" },
					{ role: "user", content: "three" },
				],
			},
			model,
		);
		expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
	});

	test("assistant turns carry the model's provider and api", () => {
		const context = toContext({ model: "m", messages: [{ role: "assistant", content: "two" }] }, model);
		expect(context.messages[0]).toMatchObject({ role: "assistant", provider: "faux", model: "m" });
	});
});

describe("toChunk", () => {
	test("maps text_delta to a content delta", () => {
		const chunk = toChunk(
			{ type: "text_delta", contentIndex: 0, delta: "hello", partial: {} as never },
			"id-1",
			"m",
		);
		expect(chunk?.choices[0].delta.content).toBe("hello");
		expect(chunk?.choices[0].finish_reason).toBeNull();
	});

	test("maps start to a role delta", () => {
		const chunk = toChunk({ type: "start", partial: {} as never }, "id-1", "m");
		expect(chunk?.choices[0].delta.role).toBe("assistant");
	});

	test("maps done to a finish reason", () => {
		const chunk = toChunk({ type: "done", reason: "stop", message: {} as never }, "id-1", "m");
		expect(chunk?.choices[0].finish_reason).toBe("stop");
	});

	test("maps length stops to the OpenAI name", () => {
		const chunk = toChunk({ type: "done", reason: "length", message: {} as never }, "id-1", "m");
		expect(chunk?.choices[0].finish_reason).toBe("length");
	});

	test("emits nothing for thinking deltas", () => {
		expect(
			toChunk({ type: "thinking_delta", contentIndex: 0, delta: "...", partial: {} as never }, "id-1", "m"),
		).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/openai.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/openai.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/openai.ts
import type { Api, AssistantMessageEvent, Context, Message, Model, Usage } from "@knightcode/ai";

export interface OpenAIChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface OpenAIChatRequest {
	model: string;
	messages: OpenAIChatMessage[];
	stream?: boolean;
	max_tokens?: number;
	temperature?: number;
}

export interface OpenAIChatChunk {
	id: string;
	object: "chat.completion.chunk";
	created: number;
	model: string;
	choices: { index: 0; delta: { role?: "assistant"; content?: string }; finish_reason: string | null }[];
}

export class OpenAIRequestError extends Error {}

const ROLES = new Set(["system", "user", "assistant"]);

export function parseChatRequest(body: unknown): OpenAIChatRequest {
	if (typeof body !== "object" || body === null) throw new OpenAIRequestError("body must be an object");
	const record = body as Record<string, unknown>;
	if (typeof record.model !== "string" || record.model.length === 0) {
		throw new OpenAIRequestError("model is required");
	}
	if (!Array.isArray(record.messages)) throw new OpenAIRequestError("messages must be an array");
	const messages: OpenAIChatMessage[] = record.messages.map((entry) => {
		if (typeof entry !== "object" || entry === null) throw new OpenAIRequestError("message must be an object");
		const message = entry as Record<string, unknown>;
		if (typeof message.role !== "string" || !ROLES.has(message.role)) {
			throw new OpenAIRequestError(`unsupported role: ${String(message.role)}`);
		}
		if (typeof message.content !== "string") throw new OpenAIRequestError("content must be a string");
		return { role: message.role as OpenAIChatMessage["role"], content: message.content };
	});
	return {
		model: record.model,
		messages,
		stream: record.stream === true,
		max_tokens: typeof record.max_tokens === "number" ? record.max_tokens : undefined,
		temperature: typeof record.temperature === "number" ? record.temperature : undefined,
	};
}

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function toContext(request: OpenAIChatRequest, model: Model<Api>): Context {
	let systemPrompt: string | undefined;
	const rest = [...request.messages];
	if (rest[0]?.role === "system") systemPrompt = rest.shift()?.content;
	const messages: Message[] = rest.map((message) => {
		const timestamp = Date.now();
		if (message.role === "assistant") {
			return {
				role: "assistant",
				content: [{ type: "text", text: message.content }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: ZERO_USAGE,
				stopReason: "stop",
				timestamp,
			};
		}
		return { role: "user", content: message.content, timestamp };
	});
	return { systemPrompt, messages };
}

export function toChunk(event: AssistantMessageEvent, id: string, model: string): OpenAIChatChunk | undefined {
	const envelope = (
		delta: { role?: "assistant"; content?: string },
		finish_reason: string | null,
	): OpenAIChatChunk => ({
		id,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [{ index: 0, delta, finish_reason }],
	});

	switch (event.type) {
		case "start":
			return envelope({ role: "assistant" }, null);
		case "text_delta":
			return envelope({ content: event.delta }, null);
		case "done":
			return envelope({}, event.reason === "toolUse" ? "tool_calls" : event.reason === "length" ? "length" : "stop");
		default:
			// Thinking and tool-call events have no OpenAI chunk equivalent here.
			// Seam 2 surfaces are single-turn text edits; tools go through ACP.
			return undefined;
	}
}
```

There are no casts in this module and there must not be: every field above is
real. `UserMessage` is `{ role, content: string | (TextContent | ImageContent)[], timestamp }`
(`types.ts:423`) and `AssistantMessage` is `{ role, content, api, provider, model, usage, stopReason, timestamp, ... }`
(`types.ts:429`). If the type checker rejects any field, the field name is wrong
— read the type, do not add a cast.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/openai.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Type check and commit**

```bash
bun run check-types
git add packages/cli/src/engine/openai.ts packages/cli/test/engine/openai.test.ts
git commit -m "feat(engine): add OpenAI request and chunk translation"
```

---

## Task 10: POST /v1/chat/completions and POST /v1/completions

**Files:**
- Create: `packages/cli/src/engine/completions.ts`
- Test: `packages/cli/test/engine/completions.test.ts`

**Interfaces:**
- Consumes: `EngineContext` (Task 5), `parseChatRequest`, `toContext`,
  `toChunk` (Task 9), `EngineRoute`, `sendJson` (Task 1), `fauxProvider`.
- Produces:
  - `export function completionsRoutes(ctx: EngineContext): readonly EngineRoute[]`

`/v1/completions` takes `{ model, prompt, suffix, max_tokens }` and returns
`{ choices: [{ text }] }` — the shape
`crates/edit_prediction/src/open_ai_compatible.rs` already consumes.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/engine/completions.test.ts
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@knightcode/ai";
import { afterEach, describe, expect, test } from "vitest";
import { completionsRoutes } from "../../src/engine/completions.ts";
import { createEngineContext } from "../../src/engine/context.ts";
import { createMemorySecretBackend } from "../../src/engine/secrets.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

describe("completions routes", () => {
	let server: EngineServer | undefined;
	const tempDir = join(tmpdir(), `knightcode-test-completions-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	const auth = { authorization: "Bearer t", "content-type": "application/json" };

	afterEach(async () => {
		await server?.close();
		server = undefined;
		if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	async function start(text = "hello from faux") {
		mkdirSync(tempDir, { recursive: true });
		const ctx = await createEngineContext({
			backend: createMemorySecretBackend(),
			indexPath: join(tempDir, "engine-accounts.json"),
		});
		const handle = fauxProvider({ responses: [fauxAssistantMessage([fauxText(text)])] });
		ctx.models.setProvider(handle.provider);
		await ctx.credentials.modify(handle.provider.id, async () => ({ type: "api_key", key: "faux-key" }));
		const model = (await ctx.models.getAvailable(handle.provider.id))[0];
		server = await startEngineServer({ token: "t", routes: completionsRoutes(ctx) });
		return { base: `http://127.0.0.1:${server.port}`, modelId: model.id, providerId: handle.provider.id };
	}

	test("rejects a malformed request with 400", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ messages: [] }),
		});
		expect(res.status).toBe(400);
	});

	test("rejects an unknown model with 404", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ model: "no-such-model", messages: [{ role: "user", content: "hi" }] }),
		});
		expect(res.status).toBe(404);
	});

	test("returns a non-streaming completion", async () => {
		const { base, modelId } = await start("plain answer");
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }] }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { choices: { message: { content: string }; finish_reason: string }[] };
		expect(body.choices[0].message.content).toContain("plain answer");
		expect(body.choices[0].finish_reason).toBe("stop");
	});

	test("streams SSE chunks ending with [DONE]", async () => {
		const { base, modelId } = await start("streamed answer");
		const res = await fetch(`${base}/v1/chat/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], stream: true }),
		});
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		const text = await res.text();
		expect(text).toContain("chat.completion.chunk");
		expect(text).toContain("streamed answer");
		expect(text.trimEnd().endsWith("data: [DONE]")).toBe(true);
	});

	test("returns FIM text for /v1/completions", async () => {
		const { base, modelId } = await start("filled middle");
		const res = await fetch(`${base}/v1/completions`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ model: modelId, prompt: "function f() {", suffix: "}", max_tokens: 32 }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { choices: { text: string }[] };
		expect(body.choices[0].text).toContain("filled middle");
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun x vitest --run test/engine/completions.test.ts`
Expected: FAIL — cannot resolve `../../src/engine/completions.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/engine/completions.ts
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { EngineContext } from "./context.ts";
import { OpenAIRequestError, parseChatRequest, toChunk, toContext } from "./openai.ts";
import { type EngineRoute, sendJson } from "./server.ts";

async function readJson(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > 4 * 1024 * 1024) throw new OpenAIRequestError("body too large");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

function findModel(ctx: EngineContext, modelId: string) {
	for (const provider of ctx.models.getProviders()) {
		const model = ctx.models.getModel(provider.id, modelId);
		if (model) return model;
	}
	return undefined;
}

export function completionsRoutes(ctx: EngineContext): readonly EngineRoute[] {
	return [
		{
			method: "POST",
			path: "/v1/chat/completions",
			handle: async (req, res) => {
				let request;
				try {
					request = parseChatRequest(await readJson(req));
				} catch (error) {
					sendJson(res, 400, { error: "bad_request", message: String(error) });
					return;
				}

				const model = findModel(ctx, request.model);
				if (!model) {
					sendJson(res, 404, { error: "unknown_model", model: request.model });
					return;
				}

				const id = `chatcmpl-${randomUUID()}`;
				const stream = ctx.models.stream(model, toContext(request, model));

				if (!request.stream) {
					let content = "";
					let finish = "stop";
					for await (const event of stream) {
						if (event.type === "text_delta") content += event.delta;
						if (event.type === "done") finish = toChunk(event, id, request.model)?.choices[0].finish_reason ?? "stop";
						if (event.type === "error") {
							sendJson(res, 502, { error: "upstream", message: event.error.errorMessage ?? "stream failed" });
							return;
						}
					}
					sendJson(res, 200, {
						id,
						object: "chat.completion",
						created: Math.floor(Date.now() / 1000),
						model: request.model,
						choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finish }],
					});
					return;
				}

				res.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-cache, no-transform",
					connection: "keep-alive",
					"x-accel-buffering": "no",
				});
				let aborted = false;
				req.on("close", () => {
					aborted = true;
				});
				for await (const event of stream) {
					if (aborted) break;
					if (event.type === "error") break;
					const chunk = toChunk(event, id, request.model);
					if (chunk) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
				}
				if (!aborted) res.write("data: [DONE]\n\n");
				res.end();
			},
		},
		{
			method: "POST",
			path: "/v1/completions",
			handle: async (req, res) => {
				const body = (await readJson(req)) as Record<string, unknown>;
				const modelId = typeof body.model === "string" ? body.model : "";
				const prompt = typeof body.prompt === "string" ? body.prompt : "";
				const suffix = typeof body.suffix === "string" ? body.suffix : "";
				const model = findModel(ctx, modelId);
				if (!model) {
					sendJson(res, 404, { error: "unknown_model", model: modelId });
					return;
				}

				const context = toContext(
					{
						model: modelId,
						messages: [
							{
								role: "system",
								content:
									"Complete the code between PREFIX and SUFFIX. Reply with the completion text only, no fences, no commentary.",
							},
							{ role: "user", content: `PREFIX:\n${prompt}\nSUFFIX:\n${suffix}` },
						],
					},
					model,
				);

				let text = "";
				for await (const event of ctx.models.stream(model, context)) {
					if (event.type === "text_delta") text += event.delta;
					if (event.type === "error") {
						sendJson(res, 502, { error: "upstream", message: event.error.errorMessage ?? "stream failed" });
						return;
					}
				}
				sendJson(res, 200, {
					id: `cmpl-${randomUUID()}`,
					object: "text_completion",
					created: Math.floor(Date.now() / 1000),
					model: modelId,
					choices: [{ index: 0, text, finish_reason: "stop" }],
				});
			},
		},
	];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun x vitest --run test/engine/completions.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Type check and commit**

```bash
bun run check-types
git add packages/cli/src/engine/completions.ts packages/cli/test/engine/completions.test.ts
git commit -m "feat(engine): add chat and FIM completion routes"
```

---

## Task 11: Entrypoint and build target

**Files:**
- Create: `packages/cli/src/engine-entry.ts`
- Modify: `scripts/build.ts`
- Test: manual, by `curl` — this task is the binary, and its behaviour is the
  sum of Tasks 1–10, already covered.

**Interfaces:**
- Consumes: everything above.
- Produces: the `knightcode-engine` binary, and one stdout line on startup:
  `{"type":"listening","port":<number>}`.

- [ ] **Step 1: Write the entrypoint**

```ts
// packages/cli/src/engine-entry.ts
#!/usr/bin/env bun
import { join } from "node:path";
import { createBunSecretBackend } from "./bun/secrets.ts";
import { getAgentDir } from "./config.ts";
import { accountsRoutes } from "./engine/accounts.ts";
import { completionsRoutes } from "./engine/completions.ts";
import { createEngineContext } from "./engine/context.ts";
import { eventsRoute } from "./engine/events.ts";
import { modelsRoute } from "./engine/models.ts";
import type { SecretBackend } from "./engine/secrets.ts";
import { startEngineServer } from "./engine/server.ts";

process.title = "knightcode-engine";
process.env.KNIGHTCODE_CODING_AGENT = "true";
process.env.AI_AGENT = "knightcode";

const token = process.env.KNIGHTCODE_ENGINE_TOKEN;
if (!token || token.length < 32) {
	console.error("KNIGHTCODE_ENGINE_TOKEN must be set to at least 32 characters");
	process.exit(2);
}

// Loopback must never go through a proxy: a corporate HTTP_PROXY otherwise
// swallows the IDE's own traffic to this server.
for (const key of ["NO_PROXY", "no_proxy"]) {
	const existing = (process.env[key] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
	for (const host of ["127.0.0.1", "localhost", "::1"]) {
		if (!existing.some((value) => value.toLowerCase() === host)) existing.push(host);
	}
	process.env[key] = existing.join(",");
}

let backend: SecretBackend | undefined;
try {
	backend = createBunSecretBackend();
	await backend.get("startup-probe");
} catch (error) {
	backend = undefined;
	console.error(`keychain unavailable, falling back to the file store: ${String(error)}`);
}

const ctx = await createEngineContext({
	backend,
	indexPath: join(getAgentDir(), "engine-accounts.json"),
	fallbackAuthPath: join(getAgentDir(), "auth.json"),
	allowModelNetwork: true,
});

const server = await startEngineServer({
	token,
	routes: [
		eventsRoute(ctx.events),
		modelsRoute(ctx),
		...accountsRoutes(ctx),
		...completionsRoutes(ctx),
	],
});

process.stdout.write(`${JSON.stringify({ type: "listening", port: server.port, keychain: ctx.keychainAvailable })}\n`);

const shutdown = () => {
	void server.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 2: Add the build target**

In `scripts/build.ts`, alongside the existing `ENTRY`:

```ts
const ENGINE_ENTRY = join(ROOT, "packages/cli/src/engine-entry.ts");
```

and inside the per-target loop, after the CLI build, add a second `Bun.build`
call with `entrypoints: [ENGINE_ENTRY]` and
`outfile: join(outDir, target.os === "win32" ? "knightcode-engine.exe" : "knightcode-engine")`,
mirroring the existing `compile` options including the Windows metadata branch
and the non-Windows `chmodSync(outfile, 0o755)`.

- [ ] **Step 3: Verify by hand**

```bash
bun run check-types
KNIGHTCODE_ENGINE_TOKEN=$(openssl rand -hex 32) bun run packages/cli/src/engine-entry.ts
```

On Windows PowerShell, generate the token with
`-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })`.

Read the port from the printed line, then, in another shell:

```bash
curl -s http://127.0.0.1:$PORT/health
curl -s http://127.0.0.1:$PORT/v1/accounts            # expect 401
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/v1/accounts
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/v1/models
```

Expected: `/health` returns `{"status":"ok"}` unauthenticated; `/v1/accounts`
without the header returns 401; with it, returns `accounts` and `loginOptions`;
`/v1/models` returns `{"models":[]}` before any sign-in.

- [ ] **Step 4: Sign in end to end**

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"providerId":"anthropic","type":"oauth"}' http://127.0.0.1:$PORT/v1/accounts/login
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/v1/accounts/login/$LOGIN_ID
```

Open the `auth_url` from the returned events, complete sign-in, then confirm the
login reports `complete`, that `/v1/models` is now populated, and that the
credential is in the OS keychain and **not** in `~/.knightcode/auth.json`.

- [ ] **Step 5: Commit**

```bash
bun run check-types
git add packages/cli/src/engine-entry.ts scripts/build.ts
git commit -m "feat(engine): add engine entrypoint and build target"
```

---

## Required tests

Every invariant below must be covered before Phase A is called done. Tasks 1–10
add them; this list is the reviewer's checklist, not a second suite.

- `/health` answers unauthenticated; every other route rejects a missing,
  malformed, or wrong bearer token before routing (Task 1);
- the server binds loopback only, and a non-loopback `Host` is rejected (Task 1);
- `/v1/chat/completions` streams SSE and stops on client disconnect without
  leaking the upstream request (Task 10);
- `/v1/completions` returns FIM output for a prefix and suffix (Task 10);
- `/v1/models` is empty with no credentials and never returns a secret (Task 8);
- `/v1/accounts` returns metadata only; no response body on any route contains a
  token, key, or refresh token (Tasks 6, 7, 8);
- an abandoned login expires and frees its callback listener (Task 7);
- concurrent `modify` calls serialize, and a refresh arriving during a login does
  not lose the newer credential (Task 4);
- keychain unavailable falls back to the file backend at `0600` and reports the
  fallback (Task 4 for the store, Task 11 for the report);
- `/events` delivers `account.changed` after a login and after a sign-out, and
  emits a heartbeat (Tasks 2, 6, 7).

---

## Exclusions

Do not add in this work package:

- any ACP code — that is WP02;
- any Rust — that is WP03;
- importing credentials from `~/.knightcode/auth.json` — spec §6.3; that is a
  first-run affordance and belongs to Phase E;
- `/v1/sessions`, a session browser, or agent-manager routes;
- tool calls in `/v1/chat/completions`; seam 2 surfaces are single-turn text
  edits and tools go through ACP;
- a second credential store, or any new dependency for keychain access;
- changes to `packages/ai` or `packages/agent`;
- changes to the CLI's system prompt or tool definitions;
- authentication schemes beyond the launch bearer token;
- remote engine support, TLS, or non-loopback binding.

---

## Validation

From the repository root:

```bash
bun run check-types
cd packages/cli && bun x vitest --run test/engine
```

Confirm no route can leak a credential:

```bash
rg -n "credential|apiKey|api_key|refresh|access" packages/cli/src/engine
```

Every match must be either a type import, a `type` discriminant on
`CredentialInfo`, or the keychain store's own serialization. A credential value
reaching a `sendJson` call is a defect.

Confirm the engine never writes `auth.json` when a keychain is present:

```bash
rg -n "auth\.json" packages/cli/src/engine packages/cli/src/engine-entry.ts
```

Expected: only the `fallbackAuthPath` wiring in `engine-entry.ts` and
`keychain-store.ts`.

---

## Stop condition

WP01 is complete when:

- `knightcode-engine` starts from a compiled binary, prints its port, and
  answers `/health`;
- an Anthropic OAuth sign-in completes through the HTTP login routes with no
  terminal interaction, storing the credential in the OS keychain;
- `/v1/models` lists that provider's models afterwards;
- `/v1/chat/completions` streams a response, and `/v1/completions` returns FIM
  text;
- `/events` reports account changes;
- every invariant in *Required tests* has a passing test;
- `bun run check-types` is clean and both greps in *Validation* return only
  their expected matches;
- `~/.knightcode/auth.json` is untouched on a machine with a working keychain.
