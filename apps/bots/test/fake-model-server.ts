// An OpenAI-compatible chat-completions server with scripted replies, for running the real Worker in the browser tests
// without billing a provider. Replies stream as server-sent events. A test scripts the next replies with
// POST /__script ({ replies?: string[], byBot?: { [botName]: reply } }); a bot is known by the "You are <name>" line of its
// system prompt. With nothing scripted the server answers "You said: <the last user message>". Words stream WORD_MS apart.
import { createServer, type IncomingMessage, type Server } from "node:http";

export const FAKE_MODELS = ["fake-model", "fake-fast"];
const WORD_MS = 40;

const read = (request: IncomingMessage) =>
	new Promise<string>((resolve) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => resolve(body));
	});

type Message = { role: string; content?: string | { type: string; text?: string }[] };

const textOf = (message: Message | undefined) =>
	typeof message?.content === "string" ? message.content : (message?.content ?? []).map((part) => part.text ?? "").join("");

export async function startFakeModelServer(port = 0): Promise<{ url: string; server: Server; close(): Promise<void> }> {
	const scripted: string[] = [];
	const byBot = new Map<string, string>();
	const passing = new Set<string>();
	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", "http://fake");
		const json = (status: number, body: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
		if (request.method === "POST" && url.pathname === "/__script") {
			const script = JSON.parse(await read(request)) as { replies?: string[]; byBot?: Record<string, string>; passInGroups?: string[] };
			scripted.push(...(script.replies ?? []));
			for (const [name, reply] of Object.entries(script.byBot ?? {})) byBot.set(name, reply);
			for (const name of script.passInGroups ?? []) passing.add(name);
			return json(200, { queued: scripted.length });
		}
		if (request.method === "GET" && url.pathname === "/v1/models")
			return json(200, { object: "list", data: FAKE_MODELS.map((id) => ({ id, object: "model", owned_by: "fake" })) });
		if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") return json(404, { error: { message: "not found" } });
		const body = JSON.parse(await read(request)) as { model: string; messages: Message[]; stream?: boolean };
		const lastUser = [...body.messages].reverse().find((message) => message.role === "user");
		const system = body.messages.filter((message) => message.role === "system" || message.role === "developer").map(textOf).join("\n");
		const bot = [...byBot.keys()].find((name) => system.includes(`You are ${name}`));
		const inGroup = system.includes("You are in the group chat");
		const named = [...passing].find((name) => system.includes(`You are ${name}`));
		const reply = inGroup && named ? "PASS" : (scripted.shift() ?? (bot ? byBot.get(bot)! : `You said: ${textOf(lastUser)}`));
		const usage = { prompt_tokens: 10, completion_tokens: reply.split(/\s+/).length, total_tokens: 10 + reply.split(/\s+/).length };
		const id = `chatcmpl-${Date.now()}`;
		if (!body.stream)
			return json(200, { id, object: "chat.completion", model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: reply } }], usage });
		response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
		const send = (chunk: unknown) => response.write(`data: ${JSON.stringify(chunk)}\n\n`);
		// A few small chunks, so the client sees the reply stream in.
		const words = reply.split(/(?<=\s)/);
		for (const word of words) {
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
