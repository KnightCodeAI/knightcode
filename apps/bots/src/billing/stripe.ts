// Stripe for the plan and top-ups (spec section 16). The plan is a subscription with a 3-day trial and a card required
// at sign-up; a top-up is a one-time payment of at least $5. Both carry the account in their metadata, which the
// webhooks read. The actual fee comes from the payment's balance transaction. The plan's price and the top-up product
// are created once in Stripe (STRIPE_PLAN_PRICE, STRIPE_TOPUP_PRODUCT); a top-up makes a one-time price for its amount.
import { MIN_TOP_UP_CENTS, PLAN } from "./plans.ts";

export class TopUpTooSmall extends Error {
	constructor() {
		super(`The smallest top-up is $${MIN_TOP_UP_CENTS / 100}.`);
		this.name = "TopUpTooSmall";
	}
}

export class StripeBilling {
	readonly #key: string;
	readonly #base: string;
	readonly #planPrice: string | undefined;
	readonly #topUpProduct: string | undefined;

	constructor(input: { secretKey: string; apiUrl?: string; planPrice?: string; topUpProduct?: string }) {
		this.#key = input.secretKey;
		this.#base = (input.apiUrl ?? "https://api.stripe.com").replace(/\/$/, "");
		this.#planPrice = input.planPrice;
		this.#topUpProduct = input.topUpProduct;
	}

	async #call<T>(method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<T> {
		const response = await fetch(`${this.#base}${path}`, {
			method,
			headers: { authorization: `Bearer ${this.#key}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
			...(form ? { body: new URLSearchParams(form) } : {}),
		});
		if (!response.ok) throw new Error(`Stripe answered ${response.status}`);
		return (await response.json()) as T;
	}

	/** Checkout for the plan: the trial, then $10 a month unless cancelled. */
	async checkoutPlan(input: { accountId: string; returnUrl: string }): Promise<{ url: string }> {
		if (!this.#planPrice) throw new Error("billing is not set up (no plan price)");
		return this.#call<{ url: string }>("POST", "/v1/checkout/sessions", {
			mode: "subscription",
			"line_items[0][quantity]": "1",
			"line_items[0][price]": this.#planPrice,
			"subscription_data[trial_period_days]": String(PLAN.trialDays),
			"subscription_data[metadata][account]": input.accountId,
			payment_method_collection: "always",
			"metadata[account]": input.accountId,
			success_url: input.returnUrl,
			cancel_url: input.returnUrl,
		});
	}

	/** Checkout for a top-up of `amountCents` (a preset or any amount from $5). */
	async checkoutTopUp(input: { accountId: string; amountCents: number; returnUrl: string }): Promise<{ url: string }> {
		if (!Number.isInteger(input.amountCents) || input.amountCents < MIN_TOP_UP_CENTS) throw new TopUpTooSmall();
		if (!this.#topUpProduct) throw new Error("billing is not set up (no top-up product)");
		const price = await this.#call<{ id: string }>("POST", "/v1/prices", {
			currency: "usd",
			product: this.#topUpProduct,
			unit_amount: String(input.amountCents),
		});
		return this.#call<{ url: string }>("POST", "/v1/checkout/sessions", {
			mode: "payment",
			"line_items[0][quantity]": "1",
			"line_items[0][price]": price.id,
			"metadata[account]": input.accountId,
			"metadata[kind]": "topup",
			"payment_intent_data[metadata][account]": input.accountId,
			success_url: input.returnUrl,
			cancel_url: input.returnUrl,
		});
	}

	/** The actual fee Stripe took on a payment, in cents. */
	async fee(paymentIntentId: string): Promise<number> {
		const intent = await this.#call<{ latest_charge?: { balance_transaction?: { fee?: number } } }>(
			"GET",
			`/v1/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge.balance_transaction`,
		);
		const fee = intent.latest_charge?.balance_transaction?.fee;
		if (typeof fee !== "number") throw new Error("Stripe reported no fee for this payment yet");
		return fee;
	}
}
