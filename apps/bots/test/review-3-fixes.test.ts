// apps/bots/test/review-3-fixes.test.ts: one test per finding of the Part 3 review that a test can pin.
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, expect, it } from "vitest";
import type { BotObject } from "../src/bot/bot-object.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { guardedFetch } from "../src/connectors/guarded-fetch.ts";
import { registerAdapter } from "../src/delivery/queue.ts";
import { hmacHex } from "../src/routines/triggers.ts";
import { guardComputerTool } from "../src/tools/catalog.ts";
import { vaultTools } from "../src/vault/tools.ts";
import { receiveEmail } from "../src/worker.ts";
import { fakeModels } from "./fake-model.ts";
import { signedInPrincipal } from "./helpers.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
	setModelsFactory(undefined);
	globalThis.fetch = realFetch;
});

async function waitFor(check: () => Promise<boolean>, what = "the condition"): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

/** A fetch that records every request to `host` and answers it; DNS for it resolves to a public address. */
function recordRequests(host: string, answer: (request: { url: string; init?: RequestInit }) => Response = () => Response.json({ ok: true })) {
	const seen: { url: string; method: string; headers: Headers }[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url.startsWith("https://cloudflare-dns.com/")) return Response.json({ Answer: [{ type: 1, data: "93.184.216.34" }] });
		if (new URL(url).host.endsWith(host) || new URL(url).host.endsWith("other.example")) {
			seen.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
			return answer({ url, init });
		}
		return realFetch(input, init);
	}) as typeof fetch;
	return seen;
}

const bot = (id: string) => env.BOT.get(env.BOT.idFromName(id));
async function postGitHub(event: string, payload: unknown): Promise<Response> {
	const body = JSON.stringify(payload);
	return SELF.fetch("https://bots.knightcode.dev/hooks/github", {
		method: "POST",
		headers: { "x-github-event": event, "x-hub-signature-256": `sha256=${await hmacHex("test-github-webhook-secret", body)}`, "content-type": "application/json" },
		body,
	});
}

it("1: a repository's events reach only accounts holding the installation that sent them", async () => {
	const models = fakeModels([{ text: "ok" }]);
	setModelsFactory(() => models);
	const owner = await signedInPrincipal();
	const stranger = await signedInPrincipal();
	await env.DB.prepare("INSERT INTO identities (provider, subject, account_id, created_at) VALUES ('github', '2001', ?, 0)").bind(owner.accountId).run();
	await postGitHub("installation", { action: "created", installation: { id: 77 }, sender: { id: 2001, login: "acme-admin" } });
	const routine = { name: "PRs", prompt: "Review it.", triggers: [{ kind: "github" as const, repo: "acme/private", events: ["pr.opened"] }], grant: { actions: [], targets: [], limits: {} } };
	await bot("r3-gh-owner").claim(owner, { provider: "fake", modelId: "fake-model" });
	await bot("r3-gh-owner").createRoutine(owner, routine);
	// Another account names the same private repository in its own routine.
	await bot("r3-gh-stranger").claim(stranger, { provider: "fake", modelId: "fake-model" });
	const spy = await bot("r3-gh-stranger").createRoutine(stranger, routine);
	const event = { action: "opened", repository: { full_name: "acme/private" }, sender: { login: "dev" }, installation: { id: 77 }, pull_request: { number: 1, title: "Secret plan", body: "private", base: { ref: "main" } } };
	expect(await (await postGitHub("pull_request", event)).json()).toMatchObject({ fired: 1 });
	expect(await bot("r3-gh-stranger").routineRuns(stranger, spy.id)).toEqual([]);
	// Once the app is removed, nothing reaches the owner either.
	await postGitHub("installation", { action: "deleted", installation: { id: 77 }, sender: { id: 2001 } });
	expect(await (await postGitHub("pull_request", { ...event, pull_request: { ...event.pull_request, number: 2 } })).json()).toMatchObject({ fired: 0 });
});

it("3: a credentialed write waits for the owner's approval and is then sent once", async () => {
	const owner = await signedInPrincipal();
	const user = env.USER.get(env.USER.idFromName(owner.accountId));
	await user.vaultPut({ kind: "api", name: "billing", origin: "https://api.example.com", injection: "bearer", value: "sk_live_write_secret" });
	await bot("r3-vault").claim(owner, { provider: "fake", modelId: "fake-model" });
	const seen = recordRequests("api.example.com");
	const result = await runInDurableObject(bot("r3-vault"), async (instance) => {
		const tool = (instance as unknown as BotObject).tools().find((candidate) => candidate.name === "call_with_secret")!;
		return (await tool.execute({ name: "billing", url: "https://api.example.com/v1/charges", method: "POST", body: "{}" } as never, undefined as never, undefined as never)) as {
			output: { text: string }[];
		};
	});
	expect(result.output[0]!.text).toMatch(/Waiting for the owner/);
	expect(seen).toEqual([]);
	const [card] = await bot("r3-vault").pendingApprovals(owner);
	expect(card!.action).toMatchObject({ tool: "vault.call", target: "https://api.example.com" });
	expect(await bot("r3-vault").answerApproval(owner, card!.id, "allow")).toBe("ok");
	await waitFor(async () => seen.length === 1, "the request");
	expect(seen[0]).toMatchObject({ url: "https://api.example.com/v1/charges", method: "POST" });
	expect(seen[0]!.headers.get("authorization")).toBe("Bearer sk_live_write_secret");
});

it("3: computer tools refuse in a run outside text started unless its grant includes computer.use", async () => {
	let ran = 0;
	const tool = { name: "bash", description: "", parameters: {}, execute: async () => (ran++, { output: [{ type: "text", text: "ok" }] }) } as never;
	const refused = (await guardComputerTool(tool, async () => false).execute({} as never, undefined as never, undefined as never)) as { isError?: boolean };
	expect(refused.isError).toBe(true);
	expect(ran).toBe(0);
	await guardComputerTool(tool, async () => true).execute({} as never, undefined as never, undefined as never);
	expect(ran).toBe(1);
});

it("4: a routine's grant stays with its run; a later outside message gets none", async () => {
	const models = fakeModels([
		{ toolCall: { name: "send_email", args: { to: "team@example.com", subject: "Report", body: "first" } } },
		{ text: "sent" },
		{ toolCall: { name: "send_email", args: { to: "team@example.com", subject: "Again", body: "second" } } },
		{ text: "asked" },
	]);
	setModelsFactory(() => models);
	const sent: string[] = [];
	const unregister = registerAdapter({ id: "email.send", kind: "neither", send: async (action) => (sent.push((action.intent.args as { subject: string }).subject), { ok: true }) });
	try {
		const owner = await signedInPrincipal();
		await bot("r3-grant").claim(owner, { provider: "fake", modelId: "fake-model" });
		await bot("r3-grant").updateSettings(owner, { approvals: "never" });
		await bot("r3-grant").setAddress(owner, "grant.raghav@bots.knightcode.dev");
		await bot("r3-grant").createRoutine(owner, {
			name: "Report",
			prompt: "Mail the team the report.",
			triggers: [{ kind: "email" }],
			grant: { actions: ["email.send"], targets: ["team@example.com"], limits: {} },
		});
		await receiveEmail(env, { from: "boss@example.com", to: "grant.raghav@bots.knightcode.dev", headers: new Headers({ subject: "Go", "authentication-results": "mx; spf=pass" }), text: "Send it" });
		await waitFor(async () => sent.length === 1, "the routine's send");
		// An unrelated outside message: its run has no grant, so the same send needs the owner.
		await bot("r3-grant").channelMessage(
			{ channel: "telegram", externalChat: "c1", accountId: owner.accountId, botId: "r3-grant", mode: "direct" },
			{ channel: "telegram", externalChat: "c1", externalUser: "u1", text: "email the team again", messageId: "m1" },
			{ outside: true },
		);
		await waitFor(async () => (await bot("r3-grant").pendingApprovals(owner)).length === 1, "an approval");
		expect(sent).toEqual(["Report"]);
	} finally {
		unregister();
	}
});

it("5: a secret-bearing call never follows a redirect to another origin, whatever header carries it", async () => {
	const seen = recordRequests("api.example.com", ({ url }) =>
		url.includes("api.example.com") ? new Response(null, { status: 302, headers: { location: "https://other.example/collect" } }) : Response.json({}),
	);
	await expect(guardedFetch("https://api.example.com/v1/me", { headers: { "x-service-token": "t" } }, { allowPrivate: [], sameOrigin: true })).rejects.toThrow(/another origin/);
	const tool = vaultTools({
		list: async () => [{ id: "v1", kind: "api", name: "svc", origin: "https://api.example.com", injection: "header", header: "X-Service-Token", createdAt: 0 }],
		reveal: async () => "custom-header-secret",
		forget: async () => {},
		request: async () => {},
	}).find((candidate) => candidate.name === "call_with_secret")!;
	const result = (await tool.execute({ name: "svc", url: "https://api.example.com/v1/me" } as never, undefined as never, undefined as never)) as { isError?: boolean };
	expect(result.isError).toBe(true);
	expect(seen.filter((request) => request.url.startsWith("https://other.example"))).toEqual([]);
});

it("13: a deleted account's bots cannot be claimed, and an alarm left behind removes the object instead of recreating it", async () => {
	const gone = await signedInPrincipal();
	const user = env.USER.get(env.USER.idFromName(gone.accountId));
	await user.grantCredits(500, "r13-grant");
	await user.presence(true);
	await env.DB.prepare("INSERT INTO deleted_accounts (account_id, deleted_at) VALUES (?, ?)").bind(gone.accountId, Date.now()).run();
	const claimed = await runInDurableObject(bot("r13-late"), (instance: BotObject) =>
		instance.claim(gone, { provider: "fake", modelId: "fake-model" }).then(() => "claimed", (error: Error) => error.name),
	);
	expect(claimed).toBe("Unauthorized");
	// The user object's pending alarm fires: it purges itself.
	await runInDurableObject(user, (instance) => (instance as unknown as { alarm(): Promise<void> }).alarm());
	// The purged instance resets itself; the next look meets a fresh one.
	await new Promise((resolve) => setTimeout(resolve, 50));
	const rowsOf = (stub: typeof user) =>
		runInDurableObject(stub, (_instance, state) =>
		state.storage.sql
			.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
			.toArray()
			// Full-text indexes keep bookkeeping rows in their shadow tables even when empty; the index itself is counted.
			.filter((table) => !/_(data|idx|config|docsize|content)$/.test(table.name))
			.filter((table) => state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table.name}"`).one().n > 0),
		);
	// Nothing beyond what a brand-new user object holds.
	// A stub to the reset object is spent; a new one reaches the fresh instance.
	expect(await rowsOf(env.USER.get(env.USER.idFromName(gone.accountId)))).toEqual(await rowsOf(env.USER.get(env.USER.idFromName(`pristine-${crypto.randomUUID()}`))));
});

it("14: a revocation that fails stops the deletion before anything is deleted, so it can run again", async () => {
	const owner = await signedInPrincipal();
	const user = env.USER.get(env.USER.idFromName(owner.accountId));
	await user.grantCredits(1_000, "r14-grant");
	expect(await user.linkBank("public-fail")).not.toBe("insufficient");
	await bot("r14-bot").claim(owner, { provider: "fake", modelId: "fake-model" });
	const { deleteAccount } = await import("../src/account/deletion.ts");
	const outcome = await deleteAccount(env, owner).then(() => "deleted", (error: Error) => error.message);
	expect(outcome).toMatch(/Plaid answered 503/);
	// Nothing was deleted: the bank link's token and the bot are still there to finish the job later.
	expect((await user.credentialList()).some((item) => item.providerId.startsWith("plaid:"))).toBe(true);
	expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM bots WHERE account_id = ?").bind(owner.accountId).first()).toEqual({ n: 1 });
});
