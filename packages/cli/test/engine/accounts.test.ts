import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { afterEach, describe, expect, test } from "vitest";
import { accountsRoutes } from "../../src/engine/accounts.ts";
import { createEngineContext, type EngineContext } from "../../src/engine/context.ts";
import { createEventBus, type EngineEvent } from "../../src/engine/events.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

const auth = { authorization: "Bearer t" };

describe("accounts routes", () => {
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
			credentials: new InMemoryCredentialStore(),
			modelsPath: null,
			events,
		});
		server = await startEngineServer({ token: "t", routes: accountsRoutes(ctx) });
		return { base: `http://127.0.0.1:${server.port}`, ctx, seen };
	}

	test("lists no accounts before anything is stored", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/accounts`, { headers: auth });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { accounts: unknown[]; loginOptions: unknown[] };
		expect(body.accounts).toEqual([]);
		expect(Array.isArray(body.loginOptions)).toBe(true);
	});

	test("login options name real providers and carry no secret", async () => {
		const { base } = await start();
		const body = (await (await fetch(`${base}/v1/accounts`, { headers: auth })).json()) as {
			loginOptions: { providerId: string; type: string; label: string; isSubscription: boolean }[];
		};
		const anthropic = body.loginOptions.filter((option) => option.providerId === "anthropic");
		expect(anthropic.length).toBeGreaterThan(0);
		expect(anthropic.some((option) => option.type === "oauth" && option.isSubscription)).toBe(true);
		expect(anthropic.every((option) => option.label.length > 0)).toBe(true);
	});

	test("lists a stored account as metadata only", async () => {
		const { base, ctx } = await start();
		await ctx.credentials.modify("anthropic", async () => ({ type: "api_key", key: "sk-do-not-leak" }));
		const raw = await (await fetch(`${base}/v1/accounts`, { headers: auth })).text();
		expect(raw).not.toContain("sk-do-not-leak");
		const body = JSON.parse(raw) as { accounts: { providerId: string; providerName: string; type: string }[] };
		expect(body.accounts).toEqual([
			expect.objectContaining({ providerId: "anthropic", type: "api_key", providerName: expect.any(String) }),
		]);
	});

	test("marks an oauth account as a subscription", async () => {
		const { base, ctx } = await start();
		await ctx.credentials.modify("anthropic", async () => ({
			type: "oauth",
			refresh: "r",
			access: "a",
			expires: Date.now() + 60_000,
		}));
		const body = (await (await fetch(`${base}/v1/accounts`, { headers: auth })).json()) as {
			accounts: { providerId: string; isSubscription: boolean }[];
		};
		expect(body.accounts).toEqual([expect.objectContaining({ providerId: "anthropic", isSubscription: true })]);
	});

	test("delete removes the account and publishes account.changed", async () => {
		const { base, ctx, seen } = await start();
		await ctx.credentials.modify("anthropic", async () => ({ type: "api_key", key: "sk-do-not-leak" }));

		const res = await fetch(`${base}/v1/accounts/anthropic`, { method: "DELETE", headers: auth });
		expect(res.status).toBe(204);
		expect(await ctx.credentials.read("anthropic")).toBeUndefined();
		expect(seen).toContainEqual({ type: "account.changed", providerId: "anthropic", authenticated: false });
	});

	test("delete of an unknown provider is 404 and publishes nothing", async () => {
		const { base, seen } = await start();
		const res = await fetch(`${base}/v1/accounts/not-a-provider`, { method: "DELETE", headers: auth });
		expect(res.status).toBe(404);
		expect(seen).toEqual([]);
	});

	test("delete of a provider with no stored credential still succeeds", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/accounts/anthropic`, { method: "DELETE", headers: auth });
		expect(res.status).toBe(204);
	});
});
