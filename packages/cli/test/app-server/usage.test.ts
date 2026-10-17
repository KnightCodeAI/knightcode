import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { afterEach, expect, test, vi } from "vitest";
import { createHeldTurn } from "./fixtures/held-turn-extension.ts";
import { cleanupServers, startServer } from "./harness.ts";
afterEach(cleanupServers);

test("token usage is pushed after each reply and equals resume's usage (§4.3)", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([fauxAssistantMessage([fauxText("hello")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	const pushed = await a.waitFor("thread/tokenUsage/updated");
	await a.waitFor("turn/completed");
	const usage = pushed.usage as { output: number; contextWindow: number };
	expect(usage.output).toBeGreaterThan(0);
	expect(usage.contextWindow).toBeGreaterThan(0);
	const b = await connect();
	const resumed = await b.client.request("thread/resume", { threadId: thread.id });
	const { contextTokens: _a, ...pushedTotals } = pushed.usage as Record<string, number>;
	const { contextTokens: _b, ...resumedTotals } = resumed.usage as Record<string, number>;
	expect(resumedTotals).toEqual(pushedTotals);
	expect((pushed.usage as { contextTokens?: number }).contextTokens).toBeGreaterThan(0);
});

test("every reply pushes cumulative billed usage including the not-yet-appended final reply", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("read", { path: "missing" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("reply"),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "read" });
	await a.waitFor("turn/completed");
	const pushed = a.notifications.filter((n) => n.method === "thread/tokenUsage/updated");
	expect(pushed).toHaveLength(2);
	const first = pushed[0].params.usage as { output: number };
	const last = pushed[1].params.usage as { output: number };
	expect(last.output).toBeGreaterThan(first.output);
	const resumed = await a.client.request("thread/resume", { threadId: thread.id });
	const { contextTokens: _a, ...totals } = last as Record<string, number>;
	const { contextTokens: _b, ...resumedTotals } = resumed.usage;
	expect(resumedTotals).toEqual(totals);
});

test("resume computes usage at the synchronous send commit", async () => {
	const held = createHeldTurn();
	const { cwd, faux, threads, connect } = await startServer({
		extraExtensions: [{ name: "held-turn", factory: held.extension }],
	});
	const a = await connect();
	const b = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("hold", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await held.entered;
	let enter!: () => void, release!: () => void;
	const entered = new Promise<void>((r) => {
		enter = r;
	});
	const gate = new Promise<void>((r) => {
		release = r;
	});
	const original = threads.resume.bind(threads);
	const spy = vi.spyOn(threads, "resume").mockImplementationOnce(async (...args) => {
		const result = await original(...args);
		enter();
		await gate;
		return result;
	});
	try {
		const pending = b.client.request("thread/resume", { threadId: thread.id });
		await entered;
		held.release();
		await a.waitFor("turn/completed");
		release();
		const response = await pending;
		const fresh = await a.client.request("thread/resume", { threadId: thread.id });
		expect(response.usage).toBeDefined();
		expect(response.usage.input + response.usage.cacheRead).toBeGreaterThan(0);
		expect(response.usage).toEqual(fresh.usage);
	} finally {
		held.release();
		release();
		spy.mockRestore();
	}
});

test("model/list exposes supported thinking levels, including off-only plain model", async () => {
	const { connect } = await startServer();
	const a = await connect();
	const { models } = await a.client.request("model/list", {});
	const reasoning = models.find((m) => m.id === "faux-1")!;
	expect(reasoning.thinkingLevels[0]).toBe("off");
	expect(reasoning.thinkingLevels.length).toBeGreaterThan(1);
	const plain = models.find((m) => m.id === "faux-plain")!;
	expect(plain.thinkingLevels).toEqual(["off"]);
});
