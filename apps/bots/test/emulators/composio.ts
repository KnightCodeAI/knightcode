// An emulated Composio (v3 REST, the parts src/connectors/composio.ts uses), so tests never reach the real service.
import { createServer, type IncomingMessage } from "node:http";

export const COMPOSIO_TEST_KEY = "composio-test-key";

const TOOLKITS = [
	{ slug: "gmail", name: "Gmail", meta: { logo: "https://logos.example/gmail.png", description: "Email from Google.", categories: [{ name: "Productivity" }] } },
	{ slug: "workday", name: "Workday", meta: { logo: "https://logos.example/workday.png", description: "HR and payroll.", categories: [{ name: "Human Resources" }] } },
	{ slug: "xero", name: "Xero", meta: { logo: "https://logos.example/xero.png", description: "Accounting.", categories: [{ name: "Accounting" }] } },
];

const read = (request: IncomingMessage) =>
	new Promise<string>((resolve) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => resolve(body));
	});

export async function startComposio(): Promise<{ url: string; close(): Promise<void> }> {
	let connections = 0;
	const deleted = new Set<string>();
	/** Tools run, for tests (GET /api/v3/__executed). */
	const executed: { tool: string; connected_account_id: string; arguments: Record<string, unknown> }[] = [];
	const origin = () => `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const server = createServer(async (request, response) => {
		const json = (status: number, body: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
		const url = new URL(request.url ?? "/", "http://composio");
		// Composio's hosted sign-in page: Allow goes back to the app's callback.
		const page = /^\/connect\/(ca_\d+)$/.exec(url.pathname);
		if (request.method === "GET" && page) {
			const next = url.searchParams.get("next") ?? "/";
			const safe = next.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
			return response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Connect</title><a href="${safe}">Allow</a>`);
		}
		if (request.headers["x-api-key"] !== COMPOSIO_TEST_KEY) return json(401, { error: "bad key" });
		if (request.method === "GET" && url.pathname === "/api/v3/__executed") return json(200, { executed });
		if (request.method === "GET" && url.pathname === "/api/v3/toolkits") {
			// Two pages, to exercise the cursor.
			const second = url.searchParams.get("cursor") === "page-2";
			return json(200, second ? { items: TOOLKITS.slice(2), next_cursor: null } : { items: TOOLKITS.slice(0, 2), next_cursor: "page-2" });
		}
		if (request.method === "POST" && url.pathname === "/api/v3/connected_accounts") {
			const body = JSON.parse(await read(request)) as { connection: { callback_url: string } };
			const id = `ca_${++connections}`;
			return json(201, { id, redirect_url: `${origin()}/connect/${id}?next=${encodeURIComponent(body.connection.callback_url)}` });
		}
		const account = /^\/api\/v3\/connected_accounts\/([^/]+)$/.exec(url.pathname);
		if (account) {
			const id = decodeURIComponent(account[1]!);
			if (deleted.has(id) || !/^ca_\d+$/.test(id) || Number(id.slice(3)) > connections) return json(404, { error: "not found" });
			if (request.method === "DELETE") {
				deleted.add(id);
				return json(200, { success: true });
			}
			if (request.method === "GET") return json(200, { id, status: "ACTIVE" });
		}
		const tool = /^\/api\/v3\/tools\/execute\/([^/]+)$/.exec(url.pathname);
		if (request.method === "POST" && tool) {
			const body = JSON.parse(await read(request)) as { connected_account_id: string; arguments: Record<string, unknown> };
			if (!body.connected_account_id) return json(200, { data: null, successful: false, error: "no connected account" });
			executed.push({ tool: decodeURIComponent(tool[1]!), connected_account_id: body.connected_account_id, arguments: body.arguments });
			return json(200, { data: { tool: decodeURIComponent(tool[1]!), echo: body.arguments }, successful: true, error: null });
		}
		return json(404, { error: "not found" });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as { port: number };
	return { url: `http://127.0.0.1:${port}/api/v3`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
