import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { APPROVAL_MODE_ENTRY, needsApproval } from "../../src/app-server/approvals.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

test("which tools each mode asks for", () => {
	expect(["bash", "edit", "my_ext_tool"].filter((t) => needsApproval("ask", t))).toEqual([
		"bash",
		"edit",
		"my_ext_tool",
	]);
	expect(needsApproval("ask", "read")).toBe(false);
	expect(["bash", "edit", "my_ext_tool", "powershell"].filter((t) => needsApproval("autoEdit", t))).toEqual([
		"bash",
		"my_ext_tool",
		"powershell",
	]);
	expect(needsApproval("fullAccess", "bash")).toBe(false);
});

async function bashTurn(
	decide: (tool: string) => "accept" | "acceptForSession" | "decline",
	mode?: "ask" | "autoEdit" | "fullAccess",
) {
	const server = await startServer();
	const a = await server.connect("desktop");
	const asked: string[] = [];
	a.client.onRequest("item/toolCall/requestApproval", async (params) => {
		asked.push(params.tool);
		return { decision: decide(params.tool) };
	});
	const { thread } = await a.client.request("thread/start", {
		cwd: server.cwd,
		...(mode ? { approvalMode: mode } : {}),
	});
	return { ...server, a, asked, thread };
}

const toolCompleted = (params: Record<string, unknown>) => (params.item as { type: string }).type === "toolCall";

test("decline blocks with the rejection reason and the item reads declined", async () => {
	const { a, faux, asked, thread } = await bashTurn(() => "decline");
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "run it" });
	await a.waitFor("turn/completed");
	expect(asked).toEqual(["bash"]);
	const done = a.notifications.find((n) => n.method === "item/completed" && toolCompleted(n.params));
	expect((done!.params.item as { status: string }).status).toBe("declined");
});

test("acceptForSession stops later requests for that non-shell tool", async () => {
	const { a, faux, asked, thread, cwd } = await bashTurn(() => "acceptForSession");
	writeFileSync(join(cwd, "a.txt"), "a\n");
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "a", newText: "b" }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "b", newText: "c" }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "run twice" });
	await a.waitFor("turn/completed");
	expect(asked).toEqual(["edit"]);
	expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("c\n");
});

test("fullAccess never asks; autoEdit asks for bash but not edit", async () => {
	const full = await bashTurn(() => "accept", "fullAccess");
	full.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await full.a.client.request("turn/start", { threadId: full.thread.id, text: "go" });
	await full.a.waitFor("turn/completed");
	expect(full.asked).toEqual([]);

	const auto = await bashTurn(() => "accept", "autoEdit");
	writeFileSync(join(auto.cwd, "a.txt"), "x\n");
	auto.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "x", newText: "y" }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await auto.a.client.request("turn/start", { threadId: auto.thread.id, text: "go" });
	await auto.a.waitFor("turn/completed");
	expect(auto.asked).toEqual(["bash"]);
});

test("an explicit mode survives unload and resume", async () => {
	const { a, threads, thread, faux } = await bashTurn(() => "accept", "autoEdit");
	faux.setResponses([fauxAssistantMessage([fauxText("hi")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hello" });
	await a.waitFor("turn/completed");
	await threads.unload(thread.id);
	const { thread: resumed } = await a.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.approvalMode).toBe("autoEdit");
});

test("a desktop thread created with the default resumes as ask on a terminal connection", async () => {
	const { a, threads, thread, faux, connect } = await bashTurn(() => "accept");
	expect(thread.approvalMode).toBe("ask");
	faux.setResponses([fauxAssistantMessage([fauxText("hi")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hello" });
	await a.waitFor("turn/completed");
	await threads.unload(thread.id);
	const terminal = await connect("tui");
	const { thread: resumed } = await terminal.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.approvalMode).toBe("ask");
});

test("a malformed stored mode restores as ask", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const manager = SessionManager.create(cwd, sessionDir);
	manager.appendCustomEntry(APPROVAL_MODE_ENTRY, "yolo");
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 });
	const id = manager.getSessionId();
	manager.close();
	const terminal = await connect("tui");
	const { thread } = await terminal.client.request("thread/resume", { threadId: id });
	expect(thread.approvalMode).toBe("ask");
});

test("a disconnect with another subscriber moves the request", async () => {
	const server = await startServer();
	const first = await server.connect("desktop");
	const second = await server.connect("desktop");
	let asked!: () => void;
	const firstAsked = new Promise<void>((resolve) => (asked = resolve));
	first.client.onRequest("item/toolCall/requestApproval", () => {
		asked();
		return new Promise(() => {});
	});
	second.client.onRequest("item/toolCall/requestApproval", async () => ({ decision: "accept" }));
	const { thread } = await first.client.request("thread/start", { cwd: server.cwd });
	await second.client.request("thread/resume", { threadId: thread.id });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await first.client.request("turn/start", { threadId: thread.id, text: "go" });
	await firstAsked;
	first.close();
	const done = await second.waitFor("item/completed", toolCompleted);
	expect((done.item as { status: string }).status).toBe("completed");
});

test("an unsubscribe with another subscriber withdraws the request from it and moves it on", async () => {
	const server = await startServer();
	const first = await server.connect("desktop");
	const second = await server.connect("desktop");
	let asked!: () => void;
	const firstAsked = new Promise<void>((resolve) => (asked = resolve));
	first.client.onRequest("item/toolCall/requestApproval", () => {
		asked();
		return new Promise(() => {});
	});
	second.client.onRequest("item/toolCall/requestApproval", async () => ({ decision: "accept" }));
	const { thread } = await first.client.request("thread/start", { cwd: server.cwd });
	await second.client.request("thread/resume", { threadId: thread.id });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await first.client.request("turn/start", { threadId: thread.id, text: "go" });
	await firstAsked;
	// The connection stays open; it only stops watching the thread.
	await first.client.request("thread/unsubscribe", { threadId: thread.id });
	await first.waitFor("serverRequest/cancelled");
	const done = await second.waitFor("item/completed", toolCompleted);
	expect((done.item as { status: string }).status).toBe("completed");
});

test("an unsubscribe with no other subscriber blocks the call as cancelled", async () => {
	const server = await startServer();
	const only = await server.connect("desktop");
	let asked!: () => void;
	const onlyAsked = new Promise<void>((resolve) => (asked = resolve));
	only.client.onRequest("item/toolCall/requestApproval", () => {
		asked();
		return new Promise(() => {});
	});
	const { thread } = await only.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await only.client.request("turn/start", { threadId: thread.id, text: "go" });
	await onlyAsked;
	await only.client.request("thread/unsubscribe", { threadId: thread.id });
	await only.waitFor("serverRequest/cancelled");
	// Not subscribed any more: it sees the turn end through the sidebar broadcast (§4.5).
	await only.waitFor(
		"thread/status/changed",
		(p) => p.threadId === thread.id && (p.status as { type: string }).type === "idle",
	);
	const turns = await only.readTurns(thread.id);
	const call = turns[0].items.find((i) => i.type === "toolCall");
	expect(call).toMatchObject({ status: "failed", output: [{ type: "text", text: "Tool call cancelled" }] });
});

test("a disconnect with no other subscriber blocks the call as cancelled, and it reads back so", async () => {
	const server = await startServer();
	const only = await server.connect("desktop");
	// Not subscribed: it sees the turn end through the sidebar broadcast (§4.5).
	const watcher = await server.connect("desktop");
	let asked!: () => void;
	const onlyAsked = new Promise<void>((resolve) => (asked = resolve));
	only.client.onRequest("item/toolCall/requestApproval", () => {
		asked();
		return new Promise(() => {});
	});
	const { thread } = await only.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await only.client.request("turn/start", { threadId: thread.id, text: "go" });
	await onlyAsked;
	only.close();
	await watcher.waitFor(
		"thread/status/changed",
		(p) => p.threadId === thread.id && (p.status as { type: string }).type === "idle",
	);
	const turns = await watcher.readTurns(thread.id);
	const call = turns[0].items.find((i) => i.type === "toolCall");
	expect(call).toMatchObject({ status: "failed", output: [{ type: "text", text: "Tool call cancelled" }] });
});

test("a plan-mode block wins: no approval request is sent", async () => {
	const { a, faux, asked, thread, cwd } = await bashTurn(() => "accept");
	writeFileSync(join(cwd, "a.txt"), "x\n");
	// `/plan <task>` enters planning and runs the task as a turn (test/suite/plan-mode.test.ts:80).
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("edit", { path: "a.txt", edits: [{ oldText: "x", newText: "y" }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("planning")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "/plan change a.txt" });
	const done = await a.waitFor("item/completed", toolCompleted);
	expect(asked).toEqual([]);
	expect(done.item).toMatchObject({
		status: "failed",
		output: [{ type: "text", text: expect.stringContaining("Plan mode") }],
	});
});
