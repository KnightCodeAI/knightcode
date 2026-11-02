// apps/bots/test/inbox.test.ts
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, expect, it } from "vitest";
import type { Principal } from "../src/auth/session.ts";
import type { BotObject } from "../src/bot/bot-object.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { registerAdapter } from "../src/delivery/queue.ts";
import { AWAY_MS, catchUp } from "../src/inbox/catch-up.ts";
import { createSuggestionTables, maySuggest, recordDismissal, recordSuggestion, SUGGESTIONS_PER_DAY } from "../src/inbox/suggestions.ts";
import { fakeModels } from "./fake-model.ts";
import { signedInPrincipal } from "./helpers.ts";

let owner: Principal;
beforeAll(async () => {
	owner = await signedInPrincipal();
});
afterEach(() => setModelsFactory(undefined));

const bot = (id: string) => env.BOT.get(env.BOT.idFromName(id));
const user = () => env.USER.get(env.USER.idFromName(owner.accountId));

it("clears an approval's inbox item when it is answered in chat", async () => {
	const models = fakeModels([{ toolCall: { name: "send_email", args: { to: "jo@example.com", subject: "Hi", body: "Hello" } } }, { text: "asked" }]);
	setModelsFactory(() => models);
	const unregister = registerAdapter({ id: "email.send", kind: "neither", send: async () => ({ ok: true }) });
	try {
		await bot("inbox-b1").claim(owner, { provider: "fake", modelId: "fake-model" });
		await bot("inbox-b1").submit(owner, "email Jo", "r-inbox");
		await waitFor(async () => (await user().inboxList()).some((item) => item.kind === "approval"));
		const [item] = (await user().inboxList()).filter((i) => i.kind === "approval");
		expect(item).toMatchObject({ botId: "inbox-b1", done: false, approvalId: expect.any(String) });
		expect(await bot("inbox-b1").answerApproval(owner, item!.approvalId!, "deny")).toBe("revoked");
		expect((await user().inboxList()).some((i) => i.id === item!.id)).toBe(false);
		expect((await user().inboxList({ includeDone: true })).find((i) => i.id === item!.id)).toMatchObject({ done: true });
	} finally {
		unregister();
	}
});

it("keeps suggestions silent until enabled and stops at the daily cap", async () => {
	await runInDurableObject(bot("suggest-bot"), (_instance, state) => {
		const sql = state.storage.sql;
		createSuggestionTables(sql);
		const now = Date.UTC(2026, 10, 2, 12);
		expect(maySuggest(sql, { enabled: false, kind: "invoices", now })).toMatchObject({ ok: false, reason: expect.stringMatching(/off/) });
		for (let i = 0; i < SUGGESTIONS_PER_DAY; i++) {
			expect(maySuggest(sql, { enabled: true, kind: "invoices", now }).ok).toBe(true);
			recordSuggestion(sql, { kind: "invoices", title: `chase ${i}`, now });
		}
		expect(maySuggest(sql, { enabled: true, kind: "invoices", now })).toMatchObject({ ok: false, reason: expect.stringMatching(/a day/) });
		// A dismissed kind waits before coming back, longer each time.
		const tomorrow = now + 86_400_000 + 1;
		recordDismissal(sql, "renewals", tomorrow);
		expect(maySuggest(sql, { enabled: true, kind: "renewals", now: tomorrow + 1_000 }).ok).toBe(false);
		expect(maySuggest(sql, { enabled: true, kind: "renewals", now: tomorrow + 86_400_000 + 1 }).ok).toBe(true);
	});
	// Through the bot's tool: off by default, so nothing reaches the inbox.
	setModelsFactory(() => fakeModels([{ text: "ok" }]));
	await bot("suggest-tool").claim(owner, { provider: "fake", modelId: "fake-model" });
	const before = (await user().inboxList()).filter((i) => i.kind === "suggestion").length;
	const result = await runInDurableObject(bot("suggest-tool"), async (instance) => {
		const tool = (instance as unknown as BotObject).tools().find((t) => t.name === "suggest_work")!;
		return (await tool.execute({ title: "Chase overdue invoices", kind: "invoices" } as never, undefined as never, undefined as never)) as {
			output: { text: string }[];
		};
	});
	expect(result.output[0]!.text).toMatch(/Not shown/);
	expect((await user().inboxList()).filter((i) => i.kind === "suggestion").length).toBe(before);
});

it("writes no catch-up when nothing happened, and one after four hours away when something did", async () => {
	let calls = 0;
	const helper = async () => {
		calls++;
		return "Two reports finished; one approval waits.";
	};
	const now = Date.UTC(2026, 10, 2, 18);
	const nothing = { finished: [], waiting: [], failed: [] };
	expect(await catchUp({ lastActivityAt: now - 5 * 60 * 60_000, now, events: nothing, helper })).toBeUndefined();
	const events = { finished: [{ botId: "b1", title: "Weekly report" }], waiting: [{ botId: "b2", title: "Approve the email" }], failed: [] };
	expect(await catchUp({ lastActivityAt: now - AWAY_MS + 60_000, now, events, helper })).toBeUndefined();
	expect(calls).toBe(0);
	const summary = await catchUp({ lastActivityAt: now - AWAY_MS - 1, now, events, helper });
	expect(summary).toMatchObject({ summary: "Two reports finished; one approval waits.", finished: events.finished, waiting: events.waiting });
	expect(calls).toBe(1);
});

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error("timed out");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
