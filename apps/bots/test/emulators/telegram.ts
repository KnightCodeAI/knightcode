// An emulated Telegram Bot API: sendMessage is recorded, and GET /test/sent lists what was sent (per test, filter by
// chat id). Updates are posted by the tests to the Worker's webhook, as Telegram would.
import { createServer, type IncomingMessage } from "node:http";

export const TELEGRAM_TEST_TOKEN = "123456:test-token";
export const TELEGRAM_TEST_SECRET = "telegram-webhook-secret";

const read = (request: IncomingMessage) =>
	new Promise<string>((resolve) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => resolve(body));
	});

export async function startTelegram(): Promise<{ url: string; close(): Promise<void> }> {
	const sent: { chat_id: string | number; text: string; reply_parameters?: { message_id: number } }[] = [];
	let nextId = 1000;
	const server = createServer(async (request, response) => {
		const json = (status: number, body: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
		const url = new URL(request.url ?? "/", "http://telegram");
		if (request.method === "GET" && url.pathname === "/test/sent") return json(200, sent);
		if (request.method === "POST" && url.pathname === `/bot${TELEGRAM_TEST_TOKEN}/sendMessage`) {
			const body = JSON.parse(await read(request)) as (typeof sent)[number];
			sent.push(body);
			return json(200, { ok: true, result: { message_id: nextId++, chat: { id: body.chat_id }, text: body.text } });
		}
		return json(404, { ok: false, description: "Not Found" });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as { port: number };
	return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
