// Bank data (spec section 22): a read-only Finance connector over Plaid that lists the user's linked bank, card, loan
// and brokerage accounts with balances and transactions. Bots use it before opening a bank's website. Each linked
// account costs a monthly fee: the month's fee for every account the link returns is reserved when it is made (too
// little balance removes it again at Plaid), and again each month; a month that cannot be paid is removed after seven
// days (the user object's renewal).
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

	/** Ends a link: Plaid forgets the item and the token stops working. An item already gone counts as removed. */
	async removeItem(accessToken: string): Promise<void> {
		const response = await fetch(`${this.#base}/item/remove`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ client_id: this.#clientId, secret: this.#secret, access_token: accessToken }),
		});
		if (response.ok) return;
		const body = (await response.json().catch(() => ({}))) as { error_code?: string };
		if (body.error_code === "ITEM_NOT_FOUND") return;
		throw new Error(`Plaid answered ${response.status}`);
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

/** Months are 30 days for the fee; the grace before an unpaid link is removed is seven. */
export const BANK_FEE_PERIOD_MS = 30 * 24 * 3600_000;
export const BANK_GRACE_MS = 7 * 24 * 3600_000;

/**
 * Links a bank: the token is exchanged and the month's fee reserved for every account the link returns. Too little
 * balance removes the item again at Plaid and refuses; otherwise the token is kept with the account's credentials.
 */
export async function linkBank(input: {
	plaid: PlaidClient;
	publicToken: string;
	reserve: (units: number) => Promise<{ id: string } | "insufficient">;
	settle: (reservationId: string, units: number) => Promise<void>;
	store: (itemId: string, accessToken: string, accounts: number) => Promise<void>;
}): Promise<BankAccount[] | "insufficient"> {
	const { accessToken, itemId } = await input.plaid.exchange(input.publicToken);
	const accounts = await input.plaid.accounts(accessToken);
	const units = Math.max(1, accounts.length);
	const reservation = await input.reserve(units);
	if (reservation === "insufficient") {
		await input.plaid.removeItem(accessToken);
		return "insufficient";
	}
	await input.store(itemId, accessToken, units);
	await input.settle(reservation.id, units);
	return accounts;
}
