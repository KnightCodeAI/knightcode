// apps/bots/test/user.test.ts
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import type { Reservation } from "../src/user/balance.ts";
import { unitCost } from "../src/user/balance.ts";
import type { UserObject } from "../src/worker.ts";
import { sessionCookie } from "./helpers.ts";

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

// ─── Helpers ────────────────────────────────────────────────────────────────

const userStub = (accountId: string) => env.USER.get(env.USER.idFromName(accountId));

type User = ReturnType<typeof userStub>;

async function seedExpiredOAuth(user: User, provider: string): Promise<void> {
	await runInDurableObject(user, (instance) =>
		(instance as unknown as UserObject).credentials().modify(provider, async () => ({
			type: "oauth",
			access: "expired-access",
			refresh: "refresh-1",
			expires: Date.now() - 60_000,
		})),
	);
}

const resolveAuth = (user: User, provider: string) =>
	runInDurableObject(user, (instance) => (instance as unknown as UserObject).resolveAuth(provider));

/** Answers the providers' OAuth token endpoints in this isolate and counts the calls. */
const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});
function countTokenEndpointCalls(): () => number {
	let calls = 0;
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		if (/\/oauth\/token$/.test(new URL(url).pathname)) {
			calls++;
			// Slow enough that a second caller would overlap a refresh in flight.
			await new Promise((resolve) => setTimeout(resolve, 20));
			return Response.json({ access_token: "fresh-access", refresh_token: "refresh-2", expires_in: 3600 });
		}
		return realFetch(input, init);
	}) as typeof fetch;
	return () => calls;
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
	return SELF.fetch(`https://bots.knightcode.dev${path}`, {
		method,
		headers: {
			origin: "https://bots.knightcode.dev",
			cookie: await sharedSession(),
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}
let session: Promise<string> | undefined;
const sharedSession = () => (session ??= sessionCookie());
const apiPost = (path: string, body: unknown) => request("POST", path, body);
const apiGet = (path: string) => request("GET", path);

const grantCredits = (user: User, cents: number) => user.grantCredits(cents, `test-grant-${crypto.randomUUID()}`);
const setSpendingLimit = (user: User, cents: number) => user.setSpendingLimit(cents);

async function rawR2Text(ref: { id: string }): Promise<string> {
	const listed = await env.FILES.list();
	const object = listed.objects.find((o) => o.key.endsWith(ref.id));
	if (!object) throw new Error(`no R2 object for ${ref.id}`);
	return (await (await env.FILES.get(object.key))!.text()) ?? "";
}
