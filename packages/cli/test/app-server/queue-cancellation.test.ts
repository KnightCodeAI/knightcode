import { fauxAssistantMessage } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

test.each([
	["turn/steer", "interrupt"],
	["turn/followUp", "interrupt"],
	["turn/steer", "unload"],
	["turn/followUp", "unload"],
	["turn/steer", "settlement"],
	["turn/followUp", "settlement"],
] as const)("pending %s cannot enqueue after %s or dispatch later input handlers", async (method, ending) => {
	let entered!: () => void;
	let release!: () => void;
	const inHook = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	let later = 0;
	const server = await startServer({
		tokensPerSecond: 50,
		extraExtensions: [
			{
				name: "queued-input",
				factory: (k) => {
					k.on("input", async (event) => {
						if (event.text === "late input") {
							entered();
							await gate;
						}
					});
					k.on("input", (event) => {
						if (event.text === "late input") later++;
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const session = server.threads.get(thread.id).session;
	server.faux.setResponses([fauxAssistantMessage("running ".repeat(100))]);
	await a.client.request("turn/start", { threadId: thread.id, text: "first" });
	const queuing = a.client.request(method, { threadId: thread.id, text: "late input" });
	// Attach the rejection expectation before stopping the owning turn.
	const outcome = queuing.then(
		() => "queued",
		(error: unknown) => error,
	);
	await inHook;
	try {
		if (ending === "interrupt") await a.client.request("turn/interrupt", { threadId: thread.id });
		else if (ending === "unload") await server.threads.unload(thread.id);
		else await session.abort(); // Ends the run without ThreadManager.interrupt's cancellation path.
		// The request must settle before the non-cooperative callback is released.
		expect(await outcome).toMatchObject({ code: "invalidParams" });
		release();
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(later).toBe(0);
		expect(session.pendingMessageCount).toBe(0);
	} finally {
		release();
	}
});
