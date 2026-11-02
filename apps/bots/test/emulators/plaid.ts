// An emulated Plaid (the endpoints src/finance/plaid.ts uses): link tokens, public token exchange and accounts.
import { createServer, type IncomingMessage } from "node:http";

export const PLAID_TEST = { clientId: "plaid-test-client", secret: "plaid-test-secret" };

const read = (request: IncomingMessage) =>
	new Promise<string>((resolve) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => resolve(body));
	});

const ACCOUNTS = [
	{ account_id: "acc-checking", name: "Everyday Checking", mask: "0042", type: "depository", balances: { current: 1520.35, iso_currency_code: "USD" } },
	{ account_id: "acc-card", name: "Rewards Card", mask: "9911", type: "credit", balances: { current: 245.1, iso_currency_code: "USD" } },
];

export async function startPlaid(): Promise<{ url: string; close(): Promise<void> }> {
	/** Access tokens whose item was removed: they no longer work. */
	const removed = new Set<string>();
	const server = createServer(async (request, response) => {
		const json = (status: number, body: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
		const body = JSON.parse((await read(request)) || "{}") as Record<string, string>;
		if (body.client_id !== PLAID_TEST.clientId || body.secret !== PLAID_TEST.secret) return json(400, { error_code: "INVALID_API_KEYS" });
		switch (request.url) {
			case "/link/token/create":
				return json(200, { link_token: "link-sandbox-123" });
			case "/item/public_token/exchange":
				if (!body.public_token?.startsWith("public-")) return json(400, { error_code: "INVALID_PUBLIC_TOKEN" });
				return json(200, { access_token: `access-${body.public_token.slice(7)}`, item_id: `item-${body.public_token.slice(7)}` });
			case "/item/remove":
				// A token named "access-fail" stands for Plaid being down.
				if (body.access_token === "access-fail") return json(503, { error_code: "INTERNAL_SERVER_ERROR" });
				if (!body.access_token?.startsWith("access-") || removed.has(body.access_token)) return json(400, { error_code: "ITEM_NOT_FOUND" });
				removed.add(body.access_token);
				return json(200, { removed: true });
			case "/accounts/get":
				if (!body.access_token?.startsWith("access-")) return json(400, { error_code: "INVALID_ACCESS_TOKEN" });
				if (removed.has(body.access_token)) return json(400, { error_code: "ITEM_NOT_FOUND" });
				return json(200, { accounts: ACCOUNTS });
			default:
				return json(404, { error_code: "NOT_FOUND" });
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as { port: number };
	return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
