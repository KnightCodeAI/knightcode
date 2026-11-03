// Agent payments (spec section 22) through Stripe's Link wallet for agents. The user links their wallet once; for each
// approved purchase the bot gets a shared payment token where the merchant accepts one (it never exposes a card number,
// so it is preferred), else a single-use card limited to the approved merchant and amount. KnightCode never stores card
// numbers. Stripe's agent payments are in preview and US-first: payments are offered only in the countries listed in
// PAYMENTS_COUNTRIES. The wallet link runs against Stripe's API (the Stripe emulator in tests). Shared payment tokens and
// single-use cards both need Stripe's agent payments access (a human task); until it is granted the Stripe provider
// issues no credential at all, rather than something that only looks like one.

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
	constructor(message = "Agent payments are not available yet: they need Stripe's agent payments access.") {
		super(message);
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

	async requestCredential(_input: Purchase & { customerId: string; acceptsSharedTokens: boolean }): Promise<PaymentCredential> {
		// A PaymentIntent id is not a credential a merchant can redeem, and its metadata restricts nothing. Shared payment
		// tokens and single-use cards come from Stripe's agent payments API, which needs access first (a human task).
		throw new CardsUnavailable();
	}
}

/**
 * Development servers only (BOTS_DEV_SEED with BOTS_DEV_PAYMENTS=test): Stripe test mode's behaviour, for the browser
 * tests. Each approved purchase gets its own single-use card, limited to that purchase, with Stripe's published test
 * card number; nothing is charged. Never used in production (the flag needs the development seed).
 */
export class TestModePayments implements PaymentsProvider {
	async linkWallet(input: { accountId: string; returnUrl: string }) {
		return { url: `${input.returnUrl}?wallet=linked`, customerId: `cus_test_${input.accountId}` };
	}

	async requestCredential(input: Purchase & { customerId: string; acceptsSharedTokens: boolean }): Promise<PaymentCredential> {
		const { merchant, amount, currency, item } = input;
		return { kind: "card", number: "4242424242424242", expMonth: 12, expYear: new Date().getUTCFullYear() + 2, cvc: "123", limitedTo: { merchant, amount, currency, item } };
	}
}

/** The payments provider for this deployment: Stripe when it is set up, test mode on a development server that asks. */
export function paymentsProviderFor(env: { STRIPE_SECRET_KEY?: string; STRIPE_API_URL?: string; BOTS_DEV_SEED?: string; BOTS_DEV_PAYMENTS?: string }): PaymentsProvider | undefined {
	if (env.BOTS_DEV_SEED === "1" && env.BOTS_DEV_PAYMENTS === "test") return new TestModePayments();
	return env.STRIPE_SECRET_KEY ? new StripeLinkProvider({ secretKey: env.STRIPE_SECRET_KEY, ...(env.STRIPE_API_URL ? { apiUrl: env.STRIPE_API_URL } : {}) }) : undefined;
}
