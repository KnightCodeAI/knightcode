// apps/bots/test/actions.test.ts
import type { Grant, Rule } from "@knightcode/bots-protocol";
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Principal } from "../src/auth/session.ts";
import { type ActionIntent, getAction, recordAction, type WriteAdapter } from "../src/bot/actions.ts";
import { consumeApproval, createApproval, digestOf } from "../src/bot/approvals.ts";
import type { BotObject } from "../src/bot/bot-object.ts";
import { decide } from "../src/bot/policy.ts";
import { inherit, isOutside, markOutside } from "../src/bot/provenance.ts";
import { deliverWithRetries, registerAdapter } from "../src/delivery/queue.ts";

const principal: Principal = { accountId: "acct-a", workspaceId: "acct-a", client: "web" };

let sent: string[] = [];
let unregister: () => void = () => {};
beforeEach(async () => {
	await botStub("b1").claim(principal, { provider: "fake", modelId: "fake-model" });
	sent = [];
	// A mail adapter that takes a while, so two answers overlap while the first send is in flight.
	unregister = registerAdapter({
		id: "email.send",
		kind: "neither",
		send: async (action) => {
			await new Promise((resolve) => setTimeout(resolve, 20));
			sent.push((action.intent.args as { to: string }).to);
			return { ok: true };
		},
	});
});
afterEach(() => unregister());

it("runs an approved action once when two devices answer together", async () => {
	const approval = await createTestApproval("b1", sendEmail("a@b.c"));
	const results = await Promise.all([answer(approval.id, "allow"), answer(approval.id, "allow")]);
	expect(results.sort()).toEqual(["ok", "used"]);
	expect(await sentCount("a@b.c")).toBe(1);
});
it("rejects an approval after the action changed", async () => {
	const approval = await createTestApproval("b1", sendEmail("a@b.c"));
	const digest = await digestOf(sendEmail("x@y.z"));
	expect(await withSql((sql) => consumeApproval(sql, approval.id, digest))).toBe("changed");
	// The original action still consumes it, once.
	expect(await withSql((sql) => consumeApproval(sql, approval.id, approval.digest))).toBe("ok");
	expect(await withSql((sql) => consumeApproval(sql, approval.id, approval.digest))).toBe("used");
});
it("never re-sends a 'neither' action with an unknown outcome", async () => {
	const adapter = flakyAdapter({ kind: "neither", failAfterSend: true });
	const actionId = await deliverWithRetries_(adapter, sendEmail("a@b.c"));
	// The queue delivers the same message again: still no second send.
	await withSql(async (sql) => deliverWithRetries(sql, adapter, getAction(sql, actionId)!));
	expect(adapter.sends).toBe(1);
	expect(await actionState(actionId)).toBe("unknown");
});
it("decides by mode, lists, grant and provenance", async () => {
	const post = commentOnPr("owner/repo");
	expect(await decide({ action: post, mode: "never", allow: [], block: [rule(post)], outside: false })).toBe("refuse");
	expect(await decide({ action: post, mode: "never", allow: [], block: [], outside: true })).toBe("ask");
	expect(await decide({ action: post, mode: "never", allow: [], block: [], outside: true, grant: grantFor(post) })).toBe("run");
	expect(await decide({ action: post, mode: "auto", allow: [], block: [], outside: false, reviewer: failingReviewer() })).toBe(
		"ask",
	);
	// Block wins over a grant; Ask asks; an allow rule runs; a grant's daily limit holds.
	expect(await decide({ action: post, mode: "never", allow: [], block: [rule(post)], outside: true, grant: grantFor(post) })).toBe(
		"refuse",
	);
	expect(await decide({ action: post, mode: "ask", allow: [], block: [], outside: false })).toBe("ask");
	expect(await decide({ action: post, mode: "ask", allow: [rule(post)], block: [], outside: false })).toBe("run");
	const limited: Grant = { ...grantFor(post), limits: { perDay: 20 } };
	expect(
		await decide({ action: post, mode: "never", allow: [], block: [], outside: true, grant: limited, used: { day: 20, run: 0 } }),
	).toBe("ask");
});
it("keeps the outside mark through a helper and a bot message", async () => {
	await withSql((sql) => markOutside(sql, "run1", "email"));
	const helper = await spawnHelper("run1");
	const next = await messageBotFrom(helper);
	expect(await withSql((sql) => isOutside(sql, next))).toBe(true);
	expect(await withSql((sql) => isOutside(sql, "unrelated-run"))).toBe(false);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const botStub = (botId: string) => env.BOT.get(env.BOT.idFromName(botId));

/** Runs `fn` on bot b1's own SQLite, inside its object. */
const withSql = <T>(fn: (sql: SqlStorage) => T | Promise<T>): Promise<T> =>
	runInDurableObject(botStub("b1"), (_instance, state) => fn(state.storage.sql));

const sendEmail = (to: string): ActionIntent => ({
	tool: "email.send",
	title: `Email ${to}`,
	target: to,
	args: { to, subject: "Hello", text: "Hi there" },
});

const commentOnPr = (repo: string): ActionIntent => ({
	tool: "github.comment",
	title: `Comment on a pull request in ${repo}`,
	target: repo,
	args: { repo, number: 1, body: "Looks good" },
});

const rule = (action: ActionIntent): Rule => ({ id: "rule-1", kind: "tool", value: action.tool });
const grantFor = (action: ActionIntent): Grant => ({ actions: [action.tool], targets: [action.target!], limits: {} });
const failingReviewer = () => async (): Promise<"pass" | "ask"> => {
	throw new Error("reviewer down");
};

function createTestApproval(botId: string, action: ActionIntent) {
	return withSql(async (sql) => {
		const record = recordAction(sql, botId, action);
		return createApproval(sql, { botId, actionId: record.id, action, policyVersion: 1, ttlMs: 60_000 });
	});
}

const answer = (approvalId: string, decision: "allow" | "deny") =>
	runInDurableObject(botStub("b1"), (instance) =>
		(instance as unknown as BotObject).answerApproval(principal, approvalId, decision),
	);

const sentCount = async (to: string) => sent.filter((address) => address === to).length;

function flakyAdapter(options: { kind: WriteAdapter["kind"]; failAfterSend: boolean }) {
	const adapter = {
		id: "flaky",
		kind: options.kind,
		sends: 0,
		send: async () => {
			adapter.sends++;
			if (options.failAfterSend) throw new Error("connection reset after the request went out");
			return { ok: true as const };
		},
	};
	return adapter;
}

/** Records `action` and delivers it with the queue's retries; returns its id. */
const deliverWithRetries_ = (adapter: WriteAdapter, action: ActionIntent) =>
	withSql(async (sql) => {
		const record = recordAction(sql, "b1", action);
		await deliverWithRetries(sql, adapter, record);
		return record.id;
	});

const actionState = (actionId: string) => withSql((sql) => getAction(sql, actionId)?.state);

/** A helper run started by `runId`. */
const spawnHelper = (runId: string) =>
	withSql((sql) => {
		const helper = `helper-of-${runId}`;
		inherit(sql, runId, helper);
		return helper;
	});

/** The run another bot starts when `runId` messages it. */
const messageBotFrom = (runId: string) =>
	withSql((sql) => {
		const next = `bot-message-from-${runId}`;
		inherit(sql, runId, next);
		return next;
	});
