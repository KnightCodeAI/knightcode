// apps/bots/test/payments.test.ts
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, expect, it } from "vitest";
import type { Principal } from "../src/auth/session.ts";
import { base64url } from "../src/auth/util.ts";
import { type BotObject, setPaymentsProvider, setSpendVerifier } from "../src/bot/bot-object.ts";
import { setModelsFactory } from "../src/bot/models.ts";
import { fakeComputers } from "../src/computer/computer-object.ts";
import { CardsUnavailable, type PaymentCredential, type PaymentsProvider, StripeLinkProvider } from "../src/payments/link.ts";
import { spendChallenge, verifySpendAssertion } from "../src/payments/spend-approvals.ts";
import { fakeModels } from "./fake-model.ts";
import { signedInPrincipal } from "./helpers.ts";

let owner: Principal;
beforeAll(async () => {
	owner = await signedInPrincipal();
	const models = fakeModels([{ text: "ok" }]);
	setModelsFactory(() => models);
});
afterEach(() => {
	setPaymentsProvider(undefined);
	setSpendVerifier(undefined);
});

const CARD = "4242424242424242";
const bot = (id: string) => env.BOT.get(env.BOT.idFromName(id));
const user = () => env.USER.get(env.USER.idFromName(owner.accountId));

/** A provider handing out single-use cards, counting requests. */
function cardProvider(): PaymentsProvider & { requests: number } {
	const provider = {
		requests: 0,
		linkWallet: async () => ({ url: "https://link.example/setup", customerId: "cus_test" }),
		requestCredential: async (input: { merchant: string; amount: number; currency: string; item: string }): Promise<PaymentCredential> => {
			provider.requests++;
			return { kind: "card", number: CARD, expMonth: 12, expYear: 2030, cvc: "123", limitedTo: input };
		},
	};
	return provider;
}

const tool = (botId: string, name: string, args: Record<string, unknown>) =>
	runInDurableObject(bot(botId), async (instance) => {
		const found = (instance as unknown as BotObject).tools().find((candidate) => candidate.name === name);
		if (!found) return { text: `no ${name}`, isError: true, missing: true };
		const result = (await found.execute(args as never, undefined as never, undefined as never)) as { output: { text: string }[]; isError?: boolean };
		return { text: result.output.map((block) => block.text).join(""), isError: result.isError ?? false, missing: false };
	});

it("refuses a passkey assertion made for a different approval", async () => {
	const assertionFor = (digest: string) => ({
		id: "pk-1",
		response: { clientDataJSON: base64url(new TextEncoder().encode(JSON.stringify({ type: "webauthn.get", challenge: spendChallenge(digest) }))) },
	});
	expect(await verifySpendAssertion(env, { accountId: owner.accountId, digest: "digest-of-this-purchase", assertion: assertionFor("digest-of-another") })).toBe(false);
	// The right challenge from a passkey the account does not have is refused too.
	expect(await verifySpendAssertion(env, { accountId: owner.accountId, digest: "digest-of-this-purchase", assertion: assertionFor("digest-of-this-purchase") })).toBe(false);
	expect(await verifySpendAssertion(env, { accountId: owner.accountId, digest: "d", assertion: { id: "pk-1", response: { clientDataJSON: "not json" } } })).toBe(false);
});

it("refuses a purchase above the bot's limit without a card or an approval", async () => {
	const provider = cardProvider();
	setPaymentsProvider(() => provider);
	await user().setCountry("US");
	await bot("buyer").claim(owner, { provider: "fake", modelId: "fake-model" });
	await user().setSpendLimit("buyer", { perPurchase: 5_000, perMonth: 20_000 });
	const result = await tool("buyer", "buy", { merchant: "Shop", amount: 7_500, currency: "usd", item: "Desk lamp" });
	expect(result).toMatchObject({ isError: true, text: expect.stringMatching(/limit of 50 per purchase/) });
	expect(await bot("buyer").pendingApprovals(owner)).toEqual([]);
	expect(provider.requests).toBe(0);
});

it("never puts a filled card number in the transcript, logs or screenshot metadata", async () => {
	const provider = cardProvider();
	setPaymentsProvider(() => provider);
	setSpendVerifier(async () => true);
	await user().setCountry("US");
	await user().grantCredits(1_000, `grant-${crypto.randomUUID()}`);
	await bot("card-bot").claim(owner, { provider: "fake", modelId: "fake-model" });
	await bot("card-bot").updateSettings(owner, { computerAccess: true });
	await bot("card-bot").setWallet(owner, "cus_test");
	await user().setSpendLimit("card-bot", { perPurchase: 5_000, perMonth: 20_000 });
	const logged: string[] = [];
	const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info };
	for (const method of ["log", "error", "warn", "info"] as const) console[method] = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
	try {
		const asked = await tool("card-bot", "buy", { merchant: "Shop", amount: 2_500, currency: "usd", item: "Desk lamp" });
		const [card] = await bot("card-bot").pendingApprovals(owner);
		expect(card!.action.spend).toEqual({ merchant: "Shop", amount: 25, currency: "USD", item: "Desk lamp" });
		expect(await bot("card-bot").answerApproval(owner, card!.id, "allow", { stand: "in" })).toBe("ok");
		const filled = await tool("card-bot", "fill_card", { approvalId: card!.id, ref: "17", field: "number" });
		expect(filled.isError).toBe(false);
		for (const text of [asked.text, filled.text, ...logged]) expect(text).not.toContain(CARD);
		const transcript = await runInDurableObject(bot("card-bot"), async (instance) => {
			const root = await (instance as unknown as BotObject).memory.conversation();
			return JSON.stringify((await root.entries({}, 50, undefined, undefined as never)).items);
		});
		expect(transcript).not.toContain(CARD);
		// The number went only to the bridge, as a masked fill.
		const requests = fakeComputers.get(owner.accountId)!.browserRequests;
		expect(requests.filter((request) => request.action === "fill")).toEqual([{ action: "fill", ref: "17", secret: CARD }]);
	} finally {
		Object.assign(console, originals);
	}
});

it("offers payments and finance only where they are available", async () => {
	await user().setCountry("IN");
	await bot("abroad").claim(owner, { provider: "fake", modelId: "fake-model" });
	expect((await tool("abroad", "buy", { merchant: "x", amount: 1, currency: "usd", item: "y" })).missing).toBe(true);
	expect((await tool("abroad", "bank_accounts", {})).missing).toBe(true);
});

it("links a Stripe wallet and asks for shared payment tokens against the Stripe emulator", async () => {
	const stripe = new StripeLinkProvider({ secretKey: env.STRIPE_SECRET_KEY!, apiUrl: env.STRIPE_API_URL });
	const wallet = await stripe.linkWallet({ accountId: owner.accountId, returnUrl: "https://bots.knightcode.dev/settings/payments" });
	expect(wallet.customerId).toMatch(/^cus_/);
	expect(wallet.url).toMatch(/^https?:\/\//);
	const purchase = { merchant: "Shop", amount: 2_500, currency: "usd", item: "Desk lamp", customerId: wallet.customerId };
	const token = await stripe.requestCredential({ ...purchase, acceptsSharedTokens: true });
	expect(token).toMatchObject({ kind: "shared_token", token: expect.stringMatching(/^pi_/), limitedTo: { merchant: "Shop", amount: 2_500 } });
	await expect(stripe.requestCredential({ ...purchase, acceptsSharedTokens: false })).rejects.toThrow(CardsUnavailable);
});

it("refuses to link a bank with too little balance, and lists accounts from the Plaid emulator once linked", async () => {
	const poor = await signedInPrincipal();
	const poorUser = env.USER.get(env.USER.idFromName(poor.accountId));
	expect(await poorUser.linkBank("public-poor")).toBe("insufficient");
	await user().grantCredits(1_000, `grant-${crypto.randomUUID()}`);
	const linked = await user().linkBank("public-rich");
	expect(linked).not.toBe("insufficient");
	const accounts = await user().bankAccounts();
	expect(accounts.map((account) => [account.name, account.mask, account.balance])).toEqual([
		["Everyday Checking", "0042", 1520.35],
		["Rewards Card", "9911", 245.1],
	]);
});
