import { fauxAssistantMessage, fauxToolCall } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

test.each(["interrupt", "unload", "settlement"] as const)("a pending steer cannot enqueue after %s", async (ending) => {
	let entered!: () => void;
	let release!: () => void;
	const inHook = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const held = createHeldTurn();
	const server = await startServer({
		extraExtensions: [
			{ name: "held-turn", factory: held.extension },
			{
				name: "queued-input",
				factory: (k) => {
					k.on("input", async (event) => {
						if (event.text === "late input") {
							entered();
							await gate;
						}
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const session = server.threads.get(thread.id).session;
	server.faux.setResponses([fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" })]);
	await a.client.request("turn/start", { threadId: thread.id, text: "first" });
	const { turn } = await a.waitFor("turn/started");
	await held.entered;
	const queuing = a.client.request("turn/steer", {
		threadId: thread.id,
		expectedTurnId: (turn as { id: string }).id,
		text: "late input",
	});
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
		expect(session.pendingMessageCount).toBe(0);
	} finally {
		release();
	}
});
