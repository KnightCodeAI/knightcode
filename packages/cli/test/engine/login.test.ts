import { afterEach, describe, expect, test } from "vitest";
import { accountsRoutes, createLoginRegistry } from "../../src/engine/accounts.ts";
import { createEngineContext, type EngineContext } from "../../src/engine/context.ts";
import { createEventBus, type EngineEvent } from "../../src/engine/events.ts";
import { createMemoryAccountIndex, createMemorySecretBackend } from "../../src/engine/secrets.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

const auth = { authorization: "Bearer t", "content-type": "application/json" };

interface LoginStateBody {
	status: "pending" | "complete" | "failed";
	loginId: string;
	events: { type: string }[];
	pendingPrompt?: { id: string; prompt: { type: string; message: string } };
	error?: string;
}

describe("login routes", () => {
	let server: EngineServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	async function start(): Promise<{ base: string; ctx: EngineContext; seen: EngineEvent[] }> {
		const events = createEventBus();
		const seen: EngineEvent[] = [];
		events.subscribe((event) => seen.push(event));
		const ctx = await createEngineContext({
			backend: createMemorySecretBackend(),
			index: createMemoryAccountIndex(),
			modelsPath: null,
			events,
		});
		server = await startEngineServer({ token: "t", routes: accountsRoutes(ctx) });
		return { base: `http://127.0.0.1:${server.port}`, ctx, seen };
	}

	async function beginLogin(base: string, providerId: string, type: string): Promise<Response> {
		return fetch(`${base}/v1/accounts/login`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ providerId, type }),
		});
	}

	async function readState(base: string, loginId: string): Promise<LoginStateBody> {
		return (await (await fetch(`${base}/v1/accounts/login/${loginId}`, { headers: auth })).json()) as LoginStateBody;
	}

	/** Poll until `predicate` holds or the deadline passes; returns the last state read. */
	async function waitFor(
		base: string,
		loginId: string,
		predicate: (state: LoginStateBody) => boolean,
	): Promise<LoginStateBody> {
		const deadline = Date.now() + 3000;
		let state = await readState(base, loginId);
		while (!predicate(state) && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10));
			state = await readState(base, loginId);
		}
		return state;
	}

	test("rejects a login for an unknown provider", async () => {
		const { base } = await start();
		expect((await beginLogin(base, "not-a-provider", "oauth")).status).toBe(404);
	});

	test("rejects an unrecognised login type", async () => {
		const { base } = await start();
		expect((await beginLogin(base, "anthropic", "not-a-type")).status).toBe(400);
	});

	test("rejects a login type the provider does not offer", async () => {
		const { base, ctx } = await start();
		// Find a provider with api-key auth but no oauth, and ask for oauth.
		const apiKeyOnly = ctx.models.getProviders().find((provider) => !provider.auth.oauth);
		expect(apiKeyOnly).toBeDefined();
		expect((await beginLogin(base, apiKeyOnly!.id, "oauth")).status).toBe(400);
	});

	test("unknown login id is 404", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/accounts/login/nope`, { headers: auth });
		expect(res.status).toBe(404);
	});

	test("an api-key login completes through prompt submission", async () => {
		const { base, ctx, seen } = await start();
		const started = (await (await beginLogin(base, "anthropic", "api_key")).json()) as { loginId: string };
		expect(started.loginId).toBeTruthy();

		const parked = await waitFor(base, started.loginId, (state) => state.pendingPrompt !== undefined);
		expect(parked.pendingPrompt?.prompt.type).toBe("secret");
		expect(parked.pendingPrompt?.prompt.message).toContain("Anthropic");

		const submitted = await fetch(`${base}/v1/accounts/login/${started.loginId}/submit`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ value: "sk-entered-secret" }),
		});
		expect(submitted.status).toBe(200);

		const done = await waitFor(base, started.loginId, (state) => state.status !== "pending");
		expect(done.status).toBe("complete");
		expect(await ctx.credentials.read("anthropic")).toEqual({ type: "api_key", key: "sk-entered-secret" });
		expect(seen).toContainEqual({ type: "account.changed", providerId: "anthropic", authenticated: true });
	});

	test("login state never echoes the entered secret", async () => {
		const { base } = await start();
		const started = (await (await beginLogin(base, "anthropic", "api_key")).json()) as { loginId: string };
		await waitFor(base, started.loginId, (state) => state.pendingPrompt !== undefined);
		await fetch(`${base}/v1/accounts/login/${started.loginId}/submit`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ value: "sk-entered-secret" }),
		});
		await waitFor(base, started.loginId, (state) => state.status !== "pending");
		const raw = await (await fetch(`${base}/v1/accounts/login/${started.loginId}`, { headers: auth })).text();
		expect(raw).not.toContain("sk-entered-secret");
	});

	test("submitting with no pending prompt is 409", async () => {
		const { base } = await start();
		const started = (await (await beginLogin(base, "anthropic", "api_key")).json()) as { loginId: string };
		await waitFor(base, started.loginId, (state) => state.pendingPrompt !== undefined);
		await fetch(`${base}/v1/accounts/login/${started.loginId}/submit`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ value: "one" }),
		});
		const second = await fetch(`${base}/v1/accounts/login/${started.loginId}/submit`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ value: "two" }),
		});
		expect(second.status).toBe(409);
	});

	test("a settled login record is forgotten rather than held forever", async () => {
		const events = createEventBus();
		const ctx = await createEngineContext({
			backend: createMemorySecretBackend(),
			index: createMemoryAccountIndex(),
			modelsPath: null,
			events,
		});
		const registry = createLoginRegistry(ctx, { pendingTtlMs: 60_000, settledTtlMs: 30 });
		const { loginId } = registry.start("anthropic", "api_key");
		expect(registry.size()).toBe(1);

		registry.cancel(loginId);
		const deadline = Date.now() + 2000;
		while (registry.size() > 0 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(registry.size()).toBe(0);
		expect(registry.get(loginId)).toBeUndefined();
	});

	test("an abandoned pending login times out and aborts its provider flow", async () => {
		const ctx = await createEngineContext({
			backend: createMemorySecretBackend(),
			index: createMemoryAccountIndex(),
			modelsPath: null,
			events: createEventBus(),
		});
		const registry = createLoginRegistry(ctx, { pendingTtlMs: 30, settledTtlMs: 5000 });
		const { loginId } = registry.start("anthropic", "api_key");

		const deadline = Date.now() + 2000;
		while (registry.get(loginId)?.status === "pending" && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		const state = registry.get(loginId);
		expect(state?.status).toBe("failed");
		expect(state?.status === "failed" ? state.error : "").toContain("timed out");
	});

	test("an abandoned login can be cancelled and stores nothing", async () => {
		const { base, ctx } = await start();
		const started = (await (await beginLogin(base, "anthropic", "api_key")).json()) as { loginId: string };
		await waitFor(base, started.loginId, (state) => state.pendingPrompt !== undefined);

		const cancelled = await fetch(`${base}/v1/accounts/login/${started.loginId}`, {
			method: "DELETE",
			headers: auth,
		});
		expect(cancelled.status).toBe(204);

		const state = await waitFor(base, started.loginId, (s) => s.status !== "pending");
		expect(state.status).toBe("failed");
		expect(await ctx.credentials.read("anthropic")).toBeUndefined();
	});
});
