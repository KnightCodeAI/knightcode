// Agent payments (spec section 22) through Stripe's Link wallet for agents. The user links their wallet once; for each
// approved purchase the bot gets a shared payment token where the merchant accepts one (it never exposes a card number,
// so it is preferred), else a single-use card limited to the approved merchant and amount. KnightCode never stores card
// numbers. Stripe's agent payments are in preview and US-first: payments are offered only in the countries listed in
// PAYMENTS_COUNTRIES. The wallet link and shared tokens run against Stripe's API (the Stripe emulator in tests); single-use
// cards need Stripe's agent payments access (a human task), so the Stripe provider refuses them until then.

export interface Purchase {
	merchant: string;
	/** In the currency's minor unit (cents). */
	amount: number;
	currency: string;
	item: string;
}

export type PaymentCredential =
	| { kind: "shared_token"; token: string; limitedTo: Purchase }
	| { kind: "card"; number: string; expMonth: number; expYear: number; cvc: string; limitedTo: Purchase };

export interface PaymentsProvider {
	/** A page where the user links their wallet; the customer the wallet belongs to. */
	linkWallet(input: { accountId: string; returnUrl: string }): Promise<{ url: string; customerId: string }>;
	/** One purchase's credential, limited to its merchant and amount. */
	requestCredential(input: Purchase & { customerId: string; acceptsSharedTokens: boolean }): Promise<PaymentCredential>;
}

export class CardsUnavailable extends Error {
	constructor() {
		super("Single-use cards need Stripe's agent payments access; this merchant does not take shared payment tokens.");
		this.name = "CardsUnavailable";
	}
}

/** Whether payments are offered to an account in `country` (ISO 3166-1 alpha-2). */
export const paymentsAvailable = (env: { PAYMENTS_COUNTRIES?: string }, country: string | undefined) =>
	!!country && (env.PAYMENTS_COUNTRIES ?? "US").split(",").map((c) => c.trim().toUpperCase()).includes(country.toUpperCase());

export class StripeLinkProvider implements PaymentsProvider {
	readonly #key: string;
	readonly #base: string;

	constructor(input: { secretKey: string; apiUrl?: string }) {
		this.#key = input.secretKey;
		this.#base = (input.apiUrl ?? "https://api.stripe.com").replace(/\/$/, "");
	}

	async #post<T>(path: string, form: Record<string, string>): Promise<T> {
		const response = await fetch(`${this.#base}${path}`, {
			method: "POST",
			headers: { authorization: `Bearer ${this.#key}`, "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams(form),
		});
		if (!response.ok) throw new Error(`Stripe answered ${response.status}`);
		return (await response.json()) as T;
	}

	async linkWallet(input: { accountId: string; returnUrl: string }) {
		const customer = await this.#post<{ id: string }>("/v1/customers", { "metadata[account]": input.accountId });
		const session = await this.#post<{ url: string }>("/v1/checkout/sessions", {
			mode: "setup",
			customer: customer.id,
			currency: "usd",
			success_url: input.returnUrl,
			cancel_url: input.returnUrl,
		});
		return { url: session.url, customerId: customer.id };
	}

	async requestCredential(input: Purchase & { customerId: string; acceptsSharedTokens: boolean }): Promise<PaymentCredential> {
		if (!input.acceptsSharedTokens) throw new CardsUnavailable();
		// A payment authorised for exactly this merchant and amount; its id is the token the merchant redeems.
		const intent = await this.#post<{ id: string }>("/v1/payment_intents", {
			amount: String(input.amount),
			currency: input.currency.toLowerCase(),
			customer: input.customerId,
			"metadata[merchant]": input.merchant,
			"metadata[item]": input.item,
		});
		const { customerId: _customer, acceptsSharedTokens: _accepts, ...limitedTo } = input;
		return { kind: "shared_token", token: intent.id, limitedTo };
	}
}
