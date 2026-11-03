// An OpenAI-compatible chat-completions server with scripted replies, for running the real Worker in the browser tests
// without billing a provider. Replies stream as server-sent events; words stream WORD_MS apart.
//
// POST /__script scripts what comes next:
//   { forBot: { [botName]: Reply[] } }  the next replies of one bot, known by the "You are <name>" line of its prompt
//   { replies: Reply[] }                 the next replies of any request
//   { byBot: { [botName]: string } }     what a bot answers whenever nothing else is scripted
//   { passInGroups: string[] }           bots that pass on their group turns
// A Reply is text, or { tool, args } for a tool call; an argument "{{last.<field>}}" takes that field of the previous tool
// result (JSON). With nothing scripted the server answers "You said: <message>" (its first 300 characters: a
// compaction request carries a whole transcript).
// GET /__echo answers with the request's own headers (a service that reflects what it was sent).
// GET /__seen?text=<t> counts the requests whose body held <t>.
// GET /__requests lists what each request asked (bot, last user text, the last few messages, tool result, tools offered)
// and when it ran, for tests to check.
import { createServer, type IncomingMessage, type Server } from "node:http";

export const FAKE_MODELS = ["fake-model", "fake-fast"];
const WORD_MS = 40;

export type Reply = string | { tool: string; args: Record<string, unknown> };

const read = (request: IncomingMessage) =>
	new Promise<string>((resolve) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => resolve(body));
	});

type Message = { role: string; content?: string | { type: string; text?: string }[] | null };

const textOf = (message: Message | undefined) =>
	typeof message?.content === "string" ? message.content : (message?.content ?? []).map((part) => part.text ?? "").join("");

/** Arguments with "{{last.<field>}}" replaced by that field of the previous tool result. */
function fill(args: Record<string, unknown>, previous: Message | undefined): Record<string, unknown> {
	let result: Record<string, unknown> = {};
	try {
		result = JSON.parse(textOf(previous)) as Record<string, unknown>;
	} catch {}
	return Object.fromEntries(
		Object.entries(args).map(([key, value]) => {
			const field = typeof value === "string" ? /^\{\{last\.(\w+)\}\}$/.exec(value)?.[1] : undefined;
			return [key, field ? result[field] : value];
		}),
	);
}

export async function startFakeModelServer(port = 0): Promise<{ url: string; server: Server; close(): Promise<void> }> {
	const scripted: Reply[] = [];
	const forBot = new Map<string, Reply[]>();
	const byBot = new Map<string, string>();
	const passing = new Set<string>();
	/** Every chat request's body, as sent. */
	const bodies: string[] = [];
	const requests: { bot?: string; user: string; recent: string; tool?: string; tools: string[]; start: number; end?: number }[] = [];
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://fake");
		const json = (status: number, body: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
		if (request.method === "POST" && url.pathname === "/__script") {
			const script = JSON.parse(await read(request)) as { replies?: Reply[]; forBot?: Record<string, Reply[]>; byBot?: Record<string, string>; passInGroups?: string[]; reset?: boolean };
			if (script.reset) {
				scripted.length = 0;
				forBot.clear();
				requests.length = 0;
			}
			scripted.push(...(script.replies ?? []));
			for (const [name, replies] of Object.entries(script.forBot ?? {})) forBot.set(name, [...(forBot.get(name) ?? []), ...replies]);
			for (const [name, reply] of Object.entries(script.byBot ?? {})) byBot.set(name, reply);
			for (const name of script.passInGroups ?? []) passing.add(name);
			return json(200, { queued: scripted.length });
		}
		if (request.method === "GET" && url.pathname === "/__requests") return json(200, { requests });
		if (request.method === "GET" && url.pathname === "/__echo") return json(200, { headers: request.headers });
		if (request.method === "GET" && url.pathname === "/__seen") return json(200, { count: bodies.filter((text) => text.includes(url.searchParams.get("text") ?? "\u0000")).length });
		if (request.method === "GET" && url.pathname === "/v1/models")
			return json(200, { object: "list", data: FAKE_MODELS.map((id) => ({ id, object: "model", owned_by: "fake" })) });
		if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") return json(404, { error: { message: "not found" } });
		const raw = await read(request);
		bodies.push(raw);
		const body = JSON.parse(raw) as { model: string; messages: Message[]; stream?: boolean; tools?: { function?: { name?: string } }[] };
		const lastUser = [...body.messages].reverse().find((message) => message.role === "user");
		const last = body.messages.at(-1);
		const system = body.messages.filter((message) => message.role === "system" || message.role === "developer").map(textOf).join("\n");
		const names = new Set([...forBot.keys(), ...byBot.keys(), ...passing]);
		const bot = [...names].find((name) => system.includes(`You are ${name}`));
		const logged: (typeof requests)[number] = { ...(bot ? { bot } : {}), user: textOf(lastUser).slice(0, 2_000), recent: body.messages.slice(-6).map(textOf).join("\n").slice(0, 8_000), ...(last?.role === "tool" ? { tool: textOf(last) } : {}), tools: (body.tools ?? []).map((tool) => tool.function?.name ?? ""), start: Date.now() };
		requests.push(logged);
		response.on("finish", () => (logged.end = Date.now()));
		const inGroup = system.includes("You are in the group chat");
		let reply: Reply;
		if (inGroup && bot && passing.has(bot)) reply = "PASS";
		else if (bot && forBot.get(bot)?.length) reply = forBot.get(bot)!.shift()!;
		else reply = scripted.shift() ?? (bot && byBot.has(bot) ? byBot.get(bot)! : `You said: ${textOf(lastUser).slice(0, 300)}`);
		const id = `chatcmpl-${Date.now()}`;
		const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
		if (typeof reply !== "string") {
			const previous = [...body.messages].reverse().find((message) => message.role === "tool");
			const call = { id: `call_${Math.random().toString(36).slice(2, 10)}`, type: "function", function: { name: reply.tool, arguments: JSON.stringify(fill(reply.args, previous)) } };
			if (!body.stream)
				return json(200, { id, object: "chat.completion", model: body.model, choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [call] } }], usage });
			response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
			const send = (chunk: unknown) => response.write(`data: ${JSON.stringify(chunk)}\n\n`);
			send({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, ...call }] }, finish_reason: null }] });
			send({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage });
			return response.end("data: [DONE]\n\n");
		}
		if (!body.stream)
			return json(200, { id, object: "chat.completion", model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: reply } }], usage });
		response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
		const send = (chunk: unknown) => response.write(`data: ${JSON.stringify(chunk)}\n\n`);
		// Small chunks, so the client sees the reply stream in.
		for (const word of reply.split(/(?<=\s)/)) {
			send({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: { content: word }, finish_reason: null }] });
			await new Promise((resolve) => setTimeout(resolve, WORD_MS));
		}
		send({ id, object: "chat.completion.chunk", model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage });
		response.end("data: [DONE]\n\n");
	});
	await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
	const { port: bound } = server.address() as { port: number };
	return { url: `http://127.0.0.1:${bound}/v1`, server, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

// Run directly: `bun test/fake-model-server.ts [port]` serves until stopped.
if (import.meta.main) {
	const running = await startFakeModelServer(Number(process.argv[2] ?? 0));
	console.log(`fake model server at ${running.url}`);
}
