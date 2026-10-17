import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

test("the harness serves model and config methods like production", async () => {
	const { connect } = await startServer();
	const a = await connect();
	expect((await a.client.request("model/list", {})).models.some((m) => m.id === "faux-1")).toBe(true);
	expect(await a.client.request("config/read", {})).toHaveProperty("settings");
});

test("a held turn stays running until released", async () => {
	const held = createHeldTurn();
	const { cwd, faux, threads, connect } = await startServer({
		extraExtensions: [{ name: "held-turn", factory: held.extension }],
	});
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	try {
		await held.entered;
		expect(threads.get(thread.id).session.isStreaming).toBe(true);
	} finally {
		held.release();
	}
	await a.waitFor("turn/completed");
});

test("unloading aborts an unreleased held turn without blocking cleanup", async () => {
	const held = createHeldTurn();
	const { cwd, faux, threads, connect } = await startServer({
		extraExtensions: [{ name: "held-turn", factory: held.extension }],
	});
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" })]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hold" });
	await held.entered;
	await threads.unload(thread.id);
	expect(threads.loadedCount()).toBe(0);
});
