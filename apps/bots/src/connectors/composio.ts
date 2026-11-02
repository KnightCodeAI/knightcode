// Composio, the long-tail source (spec section 9): its toolkits become catalog entries, a connection is started on
// Composio's hosted auth page, and tool calls pass through it with the user's connected account. Tokens stay with
// Composio, which the connect screen says in one line. The v3 REST shapes used here are confirmed against Composio's
// API before launch (a human task); tests run against test/emulators/composio.ts.
import type { CatalogCategory, CatalogEntry } from "@knightcode/bots-protocol";
import { DEFAULT_PERMISSIONS } from "./permissions.ts";

export const COMPOSIO_NOTICE = "Connected through Composio, which holds this app's sign-in and passes the bot's requests on.";

export interface ComposioOptions {
	apiKey: string;
	/** https://backend.composio.dev/api/v3 unless set (tests point it at the emulator). */
	baseUrl?: string;
	fetch?: typeof fetch;
}

type Toolkit = { slug: string; name: string; meta?: { logo?: string; description?: string; categories?: { name: string }[] } };

const CATEGORY: Record<string, CatalogCategory> = {
	"developer tools": "developer",
	productivity: "productivity",
	crm: "crm-sales",
	sales: "crm-sales",
	marketing: "marketing-social",
	"social media": "marketing-social",
	support: "support",
	"human resources": "hr",
	hr: "hr",
	finance: "finance",
	accounting: "finance",
	analytics: "data",
	data: "data",
	seo: "seo",
};

export class ComposioClient {
	readonly #options: ComposioOptions;

	constructor(options: ComposioOptions) {
		this.#options = options;
	}

	async #call<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await (this.#options.fetch ?? fetch)(`${this.#options.baseUrl ?? "https://backend.composio.dev/api/v3"}${path}`, {
			...init,
			headers: { "x-api-key": this.#options.apiKey, "content-type": "application/json", ...init.headers },
		});
		if (!response.ok) throw new Error(`Composio answered ${response.status}`);
		return (await response.json()) as T;
	}

	/** Every toolkit, as catalog entries (Composio is the last source, so overlaps lose to the others). */
	async catalog(): Promise<CatalogEntry[]> {
		const entries: CatalogEntry[] = [];
		let cursor: string | undefined;
		for (let page = 0; page < 20; page++) {
			const body = await this.#call<{ items: Toolkit[]; next_cursor?: string | null }>(
				`/toolkits?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
			);
			for (const toolkit of body.items) {
				const category = toolkit.meta?.categories?.map((c) => CATEGORY[c.name.toLowerCase()]).find(Boolean) ?? "productivity";
				entries.push({
					id: toolkit.slug,
					name: toolkit.name,
					maker: toolkit.name,
					category,
					icon: toolkit.meta?.logo ?? "",
					description: toolkit.meta?.description ?? "",
					auth: "oauth",
					skills: [],
					permissions: DEFAULT_PERMISSIONS,
					notice: COMPOSIO_NOTICE,
				});
			}
			cursor = body.next_cursor ?? undefined;
			if (!cursor) break;
		}
		return entries;
	}

	/** Starts a connection for `userId` (the account id); the user finishes it on Composio's page. */
	async connect(authConfigId: string, userId: string, callbackUrl: string): Promise<{ connectionId: string; redirectUrl: string }> {
		const body = await this.#call<{ id: string; redirect_url: string }>("/connected_accounts", {
			method: "POST",
			body: JSON.stringify({ auth_config: { id: authConfigId }, connection: { user_id: userId, callback_url: callbackUrl } }),
		});
		return { connectionId: body.id, redirectUrl: body.redirect_url };
	}

	async execute(tool: string, input: { connectionId: string; userId: string; args: Record<string, unknown> }) {
		const body = await this.#call<{ data: unknown; successful: boolean; error?: string | null }>(`/tools/execute/${encodeURIComponent(tool)}`, {
			method: "POST",
			body: JSON.stringify({ connected_account_id: input.connectionId, user_id: input.userId, arguments: input.args }),
		});
		if (!body.successful) throw new Error(body.error ?? "the Composio call failed");
		return body.data;
	}
}
