import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { randomUUID } from "node:crypto";
import { renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

type Status = { type: string; waitingOn?: string[]; message?: string };
const statusOf = (params: Record<string, unknown>) => params.status as Status;

test("an open approval shows as waitingOn on a connection that is not subscribed (§4.2)", async () => {
	const { cwd, faux, connect } = await startServer();
	const asker = await connect("desktop");
	const sidebar = await connect("desktop");
	asker.client.onRequest("item/toolCall/requestApproval", async () => {
		await sidebar.waitFor("thread/status/changed", (p) => (statusOf(p).waitingOn ?? []).includes("approval"));
		return { decision: "accept" };
	});
	const { thread } = await asker.client.request("thread/start", { cwd, approvalMode: "ask" });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await asker.client.request("turn/start", { threadId: thread.id, text: "run it" });
	await asker.waitFor("turn/completed");
	const statuses = sidebar.notifications
		.filter((n) => n.method === "thread/status/changed" && n.params.threadId === thread.id)
		.map((n) => statusOf(n.params));
	expect(statuses).toContainEqual({ type: "active", waitingOn: ["approval"] });
	// After the decision the thread is still active but no longer waiting, then idle.
	const afterWaiting = statuses.slice(statuses.findIndex((s) => (s.waitingOn ?? []).length > 0) + 1);
	expect(afterWaiting).toContainEqual({ type: "active", waitingOn: [] });
	expect(statuses.at(-1)).toEqual({ type: "idle" });
});

test("a fork's origin comes from the parent's header, not from a UUID-shaped file name", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	// A saved parent whose file name carries a different, misleading UUID, as an imported transcript can.
	const manager = SessionManager.create(cwd, sessionDir);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "parent" }], timestamp: 1 });
	const parentId = manager.getSessionId();
	const original = manager.getSessionFile()!;
	manager.close();
	const misleading = join(dirname(original), `2026-01-01T00-00-00-000Z_${randomUUID()}.jsonl`);
	renameSync(original, misleading);
	const a = await connect();
	const { thread: fork } = await a.client.request("thread/fork", { threadId: parentId });
	expect(fork.forkedFromId).toBe(parentId);
	const listed = await a.client.request("thread/list", { cwd });
	expect(listed.threads.find((t) => t.id === fork.id)?.forkedFromId).toBe(parentId);
	// Archiving the parent moves it into archived/; the fork still names it.
	await a.client.request("thread/archive", { threadId: parentId });
	const relisted = await a.client.request("thread/list", { cwd });
	expect(relisted.threads.find((t) => t.id === fork.id)?.forkedFromId).toBe(parentId);
});

test("a new thread reports createdAt, and a fork names its origin (§4.2)", async () => {
	const { cwd, faux, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	expect(Number.isNaN(Date.parse(thread.createdAt))).toBe(false);
	faux.setResponses([fauxAssistantMessage([fauxText("ok")])]);
	await a.client.request("turn/start", { threadId: thread.id, text: "hi" });
	await a.waitFor("turn/completed");
	const { thread: fork } = await a.client.request("thread/fork", { threadId: thread.id });
	expect(fork.forkedFromId).toBe(thread.id);
	// The fork is named after its source so the two can be told apart.
	expect(fork.name).toBe("hi (fork)");
	const listed = await a.client.request("thread/list", { cwd });
	expect(listed.threads.find((t) => t.id === fork.id)?.forkedFromId).toBe(thread.id);
	expect(listed.threads.find((t) => t.id === fork.id)?.name).toBe("hi (fork)");
});
