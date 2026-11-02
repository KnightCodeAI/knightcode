// 1Password (spec section 21): when a bot needs a login, the owner approves on their own device and 1Password fills
// it, so neither the bot nor KnightCode stores the password. The integration route (1Password's agent sign-in for
// personal accounts, or a service account scoped to one vault for business ones) is confirmed with 1Password before it
// is built (a human task); until then the real route stays behind ONEPASSWORD_AGENT_SIGNIN and the fake backs tests.

export type FillStatus = "approved" | "denied" | "pending" | "unavailable";

export interface OnePasswordProvider {
	/** Whether this account has 1Password connected. */
	connected(accountId: string): Promise<boolean>;
	/**
	 * Asks the owner, on their device, to fill the login for `origin` into the bot's page. 1Password fills it directly;
	 * the value never passes through KnightCode.
	 */
	requestFill(input: { accountId: string; origin: string; field: "username" | "password"; botName: string }): Promise<FillStatus>;
}

/** A provider for tests: the owner's answers are scripted per origin. */
export class FakeOnePassword implements OnePasswordProvider {
	readonly requests: { origin: string; field: string }[] = [];
	readonly #answers: Record<string, FillStatus>;
	readonly #connected: Set<string>;

	constructor(answers: Record<string, FillStatus> = {}, connected: string[] = []) {
		this.#answers = answers;
		this.#connected = new Set(connected);
	}

	async connected(accountId: string) {
		return this.#connected.has(accountId);
	}

	async requestFill(input: { accountId: string; origin: string; field: "username" | "password" }) {
		if (!this.#connected.has(input.accountId)) return "unavailable";
		this.requests.push({ origin: input.origin, field: input.field });
		return this.#answers[input.origin] ?? "pending";
	}
}

/** The route in production: off until the integration with 1Password is settled. */
export class UnsetOnePassword implements OnePasswordProvider {
	async connected() {
		return false;
	}
	async requestFill(): Promise<FillStatus> {
		return "unavailable";
	}
}

export function onePasswordFor(env: { ONEPASSWORD_AGENT_SIGNIN?: string }): OnePasswordProvider {
	// The agent sign-in route is built once 1Password confirms how third-party agent platforms integrate (a human task);
	// turning the flag on before then is a configuration mistake, not a silent no-op.
	if (env.ONEPASSWORD_AGENT_SIGNIN === "on") throw new Error("1Password's agent sign-in route is not built yet; settle the integration first");
	return new UnsetOnePassword();
}
