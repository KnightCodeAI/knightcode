// apps/bots/test/deletion.test.ts
import { env, runDurableObjectAlarm, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import { deleteAccount } from "../src/account/deletion.ts";
import { exportAccount } from "../src/account/export.ts";
import type { Principal } from "../src/auth/session.ts";
import type { BotObject } from "../src/bot/bot-object.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { PlaidClient } from "../src/finance/plaid.ts";
import { hmacHex } from "../src/routines/triggers.ts";
import { createOutboxTable, flushJournal, recordJournal } from "../src/user/journal.ts";
import { fakeModels } from "./fake-model.ts";
import { PLAID_TEST } from "./emulators/plaid.ts";
import { signedInPrincipal } from "./helpers.ts";

let owner: Principal;
beforeAll(async () => {
	owner = await signedInPrincipal();
	const models = fakeModels([{ text: "Hello from the bot." }]);
	setModelsFactory(() => models);
});

const user = () => env.USER.get(env.USER.idFromName(owner.accountId));
const bot = () => env.BOT.get(env.BOT.idFromName("doomed-bot"));
const computer = () => env.COMPUTER.get(env.COMPUTER.idFromName(owner.accountId));

async function until<T>(check: () => Promise<T | undefined>, what: string): Promise<T> {
	const deadline = Date.now() + 10_000;
	for (;;) {
		const value = await check();
		if (value !== undefined) return value;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

/** Rows in any table, and keys in the KV storage, of one object. */
const leftovers = (stub: DurableObjectStub) =>
	runInDurableObject(stub, async (_instance, state) => {
		const tables = state.storage.sql
			.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'")
			.toArray();
		const rows = tables
			.map((table) => [table.name, state.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table.name}"`).one().n] as const)
			.filter(([, count]) => count > 0);
		return { rows, keys: [...(await state.storage.list({ limit: 20 })).keys()] };
	});

const ACCOUNT_TABLES = ["accounts:id", "billing_journal", "bot_addresses", "bots", "channel_links", "composio_accounts", "email_correspondents", "email_health", "email_sends", "groups", "handles", "identities", "link_codes", "passkey_challenges", "passkeys", "routine_triggers", "sessions", "slack_teams"];
const d1Rows = async (accountId: string) => {
	const found: string[] = [];
	for (const spec of ACCOUNT_TABLES) {
		const [table, column = "account_id"] = spec.split(":");
		const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).bind(accountId).first<{ n: number }>();
		if (row!.n > 0) found.push(table!);
	}
	return found;
};

it("exports every class, then deletes the account completely and revokes its connections", async () => {
	const accountId = owner.accountId;
	// A bot with a chat and a note.
	await bot().claim(owner, { provider: "fake", modelId: "fake-model" });
	await bot().submit(owner, "Say hello", "req-hello");
	await until(async () => ((await bot().exportData(owner)).chat.some((message) => message.role === "assistant") ? true : undefined), "the reply");
	await runInDurableObject(bot(), (instance: BotObject) =>
		instance.memory.notes.write({ name: "coffee", description: "How the owner takes coffee", body: "Black, no sugar.", type: "preference" }),
	);
	// A file, a page and a workspace archive.
	await user().putFile({ name: "notes.md", kind: "bot-output", botId: "doomed-bot" }, "# Plan\nShip it.");
	await user().pageCreate("doomed-bot", "Weekly plan", [{ id: "b1", type: "text", text: "Monday: review." }], "doomed-bot");
	await env.FILES.put(`computers/${accountId}/00000001/workspace.tar`, "archive");
	// Connections: a bank link, a Composio account and a Stripe customer.
	await user().grantCredits(1_000, `grant-${crypto.randomUUID()}`);
	expect(await user().linkBank("public-doomed")).not.toBe("insufficient");
	const composio = (await (
		await fetch(`${env.COMPOSIO_BASE_URL}/connected_accounts`, {
			method: "POST",
			headers: { "x-api-key": env.COMPOSIO_API_KEY!, "content-type": "application/json" },
			body: JSON.stringify({ connection: { callback_url: "https://bots.knightcode.dev/connected" } }),
		})
	).json()) as { id: string };
	await env.DB.prepare("INSERT INTO composio_accounts (connected_account_id, account_id, app_id) VALUES (?, ?, 'gmail')").bind(composio.id, accountId).run();
	const stripeCall = (method: string, path: string, form?: Record<string, string>) =>
		fetch(`${env.STRIPE_API_URL}${path}`, {
			method,
			headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
			...(form ? { body: new URLSearchParams(form) } : {}),
		});
	const customer = (await (await stripeCall("POST", "/v1/customers", { email: "owner@example.com" })).json()) as { id: string };
	await user().applyBilling([{ type: "customer", id: customer.id }]);
	// Something waiting to run later.
	await user().presence(true);

	const exported = await exportAccount(env, owner);
	expect(exported.chats[0]!.messages.map((message) => message.text)).toEqual(["Say hello", "Hello from the bot."]);
	expect(exported.notes[0]!.notes.map((note) => note.body)).toEqual(["Black, no sugar."]);
	expect(exported.files.map((file) => [file.ref.name, atob(file.base64)])).toEqual([["notes.md", "# Plan\nShip it."]]);
	expect(JSON.stringify(exported.pages)).toContain("Monday: review.");
	expect(exported.recipes.map((recipe) => recipe.profile.name)).toEqual(["Bot"]);
	expect(JSON.stringify(exported.recipes[0]!.memory)).toContain("Black, no sugar.");

	const report = await deleteAccount(env, owner);
	expect(report).toMatchObject({ bots: 1, revoked: { composio: 1, plaid: 1, stripe: 1 } });

	// No D1 row, Durable Object storage or R2 object remains; the tombstone does.
	expect(await d1Rows(accountId)).toEqual([]);
	expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM deleted_accounts WHERE account_id = ?").bind(accountId).first()).toEqual({ n: 1 });
	for (const stub of [bot(), user(), computer()]) expect(await leftovers(stub as never)).toEqual({ rows: [], keys: [] });
	for (const prefix of [`files/${accountId}/`, `computers/${accountId}/`]) expect((await env.FILES.list({ prefix })).objects).toEqual([]);

	// The connections are revoked at the providers.
	expect((await fetch(`${env.COMPOSIO_BASE_URL}/connected_accounts/${composio.id}`, { headers: { "x-api-key": env.COMPOSIO_API_KEY! } })).status).toBe(404);
	await expect(new PlaidClient({ ...PLAID_TEST, apiUrl: env.PLAID_API_URL }).accounts("access-doomed")).rejects.toThrow(/400/);
	const deleted = await stripeCall("GET", `/v1/customers/${customer.id}`);
	expect(deleted.status === 404 || ((await deleted.json()) as { deleted?: boolean }).deleted === true).toBe(true);
});

it("does not let a recovery alarm or a late webhook recreate the deleted account", async () => {
	const accountId = owner.accountId;
	// Every alarm went with the account.
	expect(await runDurableObjectAlarm(user())).toBe(false);
	expect(await runDurableObjectAlarm(bot())).toBe(false);
	expect(await runDurableObjectAlarm(computer())).toBe(false);

	// A late Stripe event is dropped.
	const raw = JSON.stringify({ id: "evt_late", type: "invoice.paid", data: { object: { id: "in_late", amount_paid: 1000, metadata: { account: accountId } } } });
	const t = Math.floor(Date.now() / 1000);
	const response = await SELF.fetch("https://bots.knightcode.dev/hooks/stripe", {
		method: "POST",
		headers: { "stripe-signature": `t=${t},v1=${await hmacHex(env.STRIPE_WEBHOOK_SECRET!, `${t}.${raw}`)}` },
		body: raw,
	});
	expect(response.status).toBe(200);
	expect(await leftovers(user() as never)).toEqual({ rows: [], keys: [] });

	// A recovery job that still holds journal entries (a lost instance's) writes nothing back.
	await runInDurableObject(user(), async (_instance, state) => {
		createOutboxTable(state.storage.sql);
		recordJournal(state.storage.sql, { key: "grant:late", kind: "grant", cents: 500, ref: "late" });
		await flushJournal(state.storage.sql, env.DB, accountId);
	});
	expect(await d1Rows(accountId)).toEqual([]);
});
