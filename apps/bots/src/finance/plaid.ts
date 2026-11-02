// Bank data (spec section 22): a read-only Finance connector over Plaid that lists the user's linked bank, card, loan
// and brokerage accounts with balances and transactions. Bots use it before opening a bank's website. Each linked
// account costs a monthly fee, reserved from credits before the link is made: too little balance refuses the link.
// Plaid covers the US, Canada, the UK and the EU; Finance is hidden elsewhere.

export const PLAID_COUNTRIES = [
	"US", "CA", "GB", "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
	"LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
];

export const financeAvailable = (country: string | undefined) => !!country && PLAID_COUNTRIES.includes(country.toUpperCase());

export interface BankAccount {
	id: string;
	name: string;
	mask: string;
	type: string;
	balance: number;
	currency: string;
}

export class PlaidClient {
	readonly #clientId: string;
	readonly #secret: string;
	readonly #base: string;

	constructor(input: { clientId: string; secret: string; apiUrl?: string }) {
		this.#clientId = input.clientId;
		this.#secret = input.secret;
		this.#base = (input.apiUrl ?? "https://production.plaid.com").replace(/\/$/, "");
	}

	async #post<T>(path: string, body: Record<string, unknown>): Promise<T> {
		const response = await fetch(`${this.#base}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ client_id: this.#clientId, secret: this.#secret, ...body }),
		});
		if (!response.ok) throw new Error(`Plaid answered ${response.status}`);
		return (await response.json()) as T;
	}

	/** The token the browser's Plaid Link starts with, for read-only products. */
	async linkToken(accountId: string, country: string): Promise<string> {
		const body = await this.#post<{ link_token: string }>("/link/token/create", {
			user: { client_user_id: accountId },
			client_name: "KnightCode Bots",
			products: ["transactions"],
			country_codes: [country.toUpperCase()],
			language: "en",
		});
		return body.link_token;
	}

	async exchange(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
		const body = await this.#post<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
		return { accessToken: body.access_token, itemId: body.item_id };
	}

	/** Ends a link: Plaid forgets the item and the token stops working. */
	async removeItem(accessToken: string): Promise<void> {
		await this.#post("/item/remove", { access_token: accessToken });
	}

	async accounts(accessToken: string): Promise<BankAccount[]> {
		const body = await this.#post<{
			accounts: { account_id: string; name: string; mask: string | null; type: string; balances: { current: number | null; iso_currency_code: string | null } }[];
		}>("/accounts/get", { access_token: accessToken });
		return body.accounts.map((account) => ({
			id: account.account_id,
			name: account.name,
			mask: account.mask ?? "",
			type: account.type,
			balance: account.balances.current ?? 0,
			currency: account.balances.iso_currency_code ?? "USD",
		}));
	}
}

/**
 * Links a bank for an account: the month's fee is reserved first (refused with too little balance), then the token is
 * exchanged and kept with the account's credentials. Returns the linked accounts.
 */
export async function linkBank(input: {
	plaid: PlaidClient;
	publicToken: string;
	reserve: () => Promise<{ id: string } | "insufficient">;
	settle: (reservationId: string) => Promise<void>;
	store: (itemId: string, accessToken: string) => Promise<void>;
}): Promise<BankAccount[] | "insufficient"> {
	const reservation = await input.reserve();
	if (reservation === "insufficient") return "insufficient";
	const { accessToken, itemId } = await input.plaid.exchange(input.publicToken);
	await input.store(itemId, accessToken);
	await input.settle(reservation.id);
	return input.plaid.accounts(accessToken);
}
