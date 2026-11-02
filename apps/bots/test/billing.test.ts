// apps/bots/test/billing.test.ts
import { env, SELF } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";
import type { Principal } from "../src/auth/session.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { computerHoursCredits, creditsForPayment, PLAN, planAllows } from "../src/billing/plans.ts";
import { StripeBilling, TopUpTooSmall } from "../src/billing/stripe.ts";
import { usageByModel } from "../src/billing/usage.ts";
import { billingChanges, type StripeEvent } from "../src/billing/webhooks.ts";
import { hmacHex } from "../src/routines/triggers.ts";
import { setRoutineClock } from "../src/routines/routines.ts";
import { fakeModels } from "./fake-model.ts";
import { signedInPrincipal } from "./helpers.ts";

const SECRET = "test-stripe-webhook-secret";
let owner: Principal;
beforeAll(async () => {
	owner = await signedInPrincipal();
	setModelsFactory(() => fakeModels([{ text: "ok" }]));
});

const userOf = (accountId: string) => env.USER.get(env.USER.idFromName(accountId));
const event = (type: string, object: Record<string, unknown>, id = `evt_${crypto.randomUUID()}`): StripeEvent => ({ id, type, data: { object: { id: "obj", ...object } as never } });

/** Posts `body` to the Stripe webhook as Stripe would sign it. */
async function deliver(body: StripeEvent, secret = SECRET) {
	const raw = JSON.stringify(body);
	const t = Math.floor(Date.now() / 1000);
	return SELF.fetch("https://bots.knightcode.dev/hooks/stripe", {
		method: "POST",
		headers: { "stripe-signature": `t=${t},v1=${await hmacHex(secret, `${t}.${raw}`)}`, "content-type": "application/json" },
		body: raw,
	});
}

it("a replayed invoice.paid credits once, and a forged signature changes nothing", async () => {
	const account = (await signedInPrincipal()).accountId;
	const paid = event("invoice.paid", { id: "in_1", amount_paid: 1000, parent: { subscription_details: { metadata: { account } } } });
	const forged = await deliver(paid, "wrong-secret");
	expect(forged.status).toBe(401);
	expect((await userOf(account).balance()).credits).toBe(0);
	for (let i = 0; i < 3; i++) expect((await deliver(paid)).status).toBe(200);
	expect((await userOf(account).balance()).credits).toBe(computerHoursCredits(PLAN.includedComputerHours));
	expect(await userOf(account).plan()).toBe("active");
});

it("a $5 top-up with a $0.45 fee credits (5 - 0.45) / 1.1 dollars of cost, and a $4 top-up is refused", async () => {
	expect(creditsForPayment(500, 45)).toBe(Math.floor(455 / 1.1));
	const account = "acct-topup";
	const completed = event("checkout.session.completed", { metadata: { account, kind: "topup" }, payment_status: "paid", amount_total: 500, payment_intent: "pi_5" });
	const changes = await billingChanges(completed, { fee: async (intent) => (intent === "pi_5" ? 45 : 0) });
	expect(changes).toEqual({ accountId: account, changes: [{ type: "grant", cents: 413, key: "topup:pi_5" }] });
	await userOf(account).applyBilling(changes!.changes);
	await userOf(account).applyBilling(changes!.changes);
	expect((await userOf(account).balance()).credits).toBe(413);

	// A refund comes off once.
	const refund = await billingChanges(event("charge.refunded", { id: "ch_5", amount_refunded: 500, metadata: { account } }), { fee: async () => 0 });
	await userOf(account).applyBilling(refund!.changes);
	await userOf(account).applyBilling(refund!.changes);
	expect((await userOf(account).balance()).credits).toBe(413 - Math.floor(500 / 1.1));

	const product = (await (
		await fetch(`${env.STRIPE_API_URL}/v1/products`, {
			method: "POST",
			headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ name: "KnightCode Bots credits" }),
		})
	).json()) as { id: string };
	const stripe = new StripeBilling({ secretKey: env.STRIPE_SECRET_KEY!, apiUrl: env.STRIPE_API_URL, topUpProduct: product.id });
	await expect(stripe.checkoutTopUp({ accountId: account, amountCents: 400, returnUrl: "https://bots.knightcode.dev/billing" })).rejects.toThrow(TopUpTooSmall);
	const checkout = await stripe.checkoutTopUp({ accountId: account, amountCents: 500, returnUrl: "https://bots.knightcode.dev/billing" });
	expect(checkout.url).toMatch(/^https?:\/\//);
});

it("bank links and Composio overage are unavailable during the trial", async () => {
	const account = (await signedInPrincipal()).accountId;
	const trial = await billingChanges(event("customer.subscription.created", { id: "sub_t", status: "trialing", metadata: { account } }), { fee: async () => 0 });
	await userOf(account).applyBilling(trial!.changes);
	await userOf(account).applyBilling(trial!.changes);
	expect(await userOf(account).plan()).toBe("trialing");
	expect((await userOf(account).balance()).credits).toBe(computerHoursCredits(PLAN.trialComputerHours));
	expect(await userOf(account).reserve("bank", 1)).toBe("insufficient");
	expect(await userOf(account).reserve("composio", 1)).toBe("insufficient");
	expect(await userOf(account).linkBank("public-trial")).toBe("insufficient");
	// The trial's computer time works.
	expect(await userOf(account).reserve("computer", 1)).toMatchObject({ kind: "computer" });
});

it("a failed renewal stops routines and the computer, while sign-in, history and export still work", async () => {
	const userObject = userOf(owner.accountId);
	await userObject.applyBilling([{ type: "grant", cents: 1000, key: "seed-lapse" }, { type: "plan", status: "active" }]);
	const bot = env.BOT.get(env.BOT.idFromName("lapsing-bot"));
	await bot.claim(owner, { provider: "fake", modelId: "fake-model" });
	const routine = await bot.createRoutine(owner, {
		name: "Daily",
		prompt: "Say hi",
		triggers: [{ kind: "schedule", cron: "0 9 * * *", timeZone: "UTC" }],
		grant: { actions: [], targets: [], limits: {} },
	});

	const failed = await billingChanges(event("invoice.payment_failed", { id: "in_f", parent: { subscription_details: { metadata: { account: owner.accountId } } } }), {
		fee: async () => 0,
	});
	await userObject.applyBilling(failed!.changes);
	expect(await userObject.plan()).toBe("lapsed");
	expect(await userObject.reserve("computer", 1)).toBe("insufficient");

	setRoutineClock(() => Date.now());
	await bot.routineFire(routine.id, Date.now());
	expect(await bot.routineRuns(owner, routine.id)).toEqual([]);
	for (const feature of ["sign_in", "history", "export"] as const) expect(planAllows("lapsed", feature)).toBe(true);
	expect(planAllows("lapsed", "routines")).toBe(false);
	setRoutineClock(undefined);
});

it("records usage per bot, routine and model from the providers' usage reports", async () => {
	const deltas = usageByModel([
		{ provider: "fake", model: "fake-model", usage: { input: 20, output: 4, cost: { total: 0.002 } } },
		{ provider: "fake", model: "fake-model", usage: { input: 30, output: 6, cost: { total: 0.003 } } },
		{ provider: "fake", model: "fake-fast", usage: { input: 5, output: 1 } },
		{ provider: "fake", model: "fake-fast" },
	]);
	expect(deltas.map((delta) => [delta.model, delta.input, delta.output])).toEqual([
		["fake/fake-model", 50, 10],
		["fake/fake-fast", 5, 1],
	]);
	const account = "acct-usage";
	await userOf(account).recordUsage(deltas.map((delta) => ({ ...delta, botId: "b1", routineId: "r1" })));
	await userOf(account).recordUsage([{ botId: "b2", model: "fake/fake-model", input: 1, output: 1, cost: 0 }]);
	const usage = await userOf(account).usage();
	expect(usage.byBot.map((row) => [row.key, row.runs])).toEqual([
		["b1", 2],
		["b2", 1],
	]);
	expect(usage.byRoutine.map((row) => row.key)).toEqual(["r1"]);
	expect(usage.byModel.find((row) => row.key === "fake/fake-model")).toMatchObject({ input: 51, output: 11 });
});
