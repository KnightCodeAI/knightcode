import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import type { ApprovalResult } from "@knightcode/app-server-protocol";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, expect, test } from "vitest";
import { cleanupServers, startServer } from "./harness.ts";
const temporaryDirs: string[] = [];
afterEach(async () => {
	await cleanupServers();
	for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("powershell never offers acceptForSession and unoffered answers cannot execute", async () => {
	let executed = 0;
	const { cwd, faux, connect, threads } = await startServer({
		extraExtensions: [
			{
				name: "fake-shell",
				factory: (k) => {
					k.registerTool({
						name: "powershell",
						label: "PowerShell",
						description: "test shell",
						parameters: Type.Object({ command: Type.String() }),
						execute: async () => {
							executed++;
							return { content: [{ type: "text", text: "ran" }], details: {} };
						},
					});
				},
			},
		],
	});
	const a = await connect("desktop");
	const decisions: string[][] = [];
	a.client.onRequest("item/toolCall/requestApproval", async (p) => {
		decisions.push(p.decisions);
		return { decision: "acceptForSession" };
	});
	const { thread } = await a.client.request("thread/start", { cwd });
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("powershell", { command: "echo hi" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("done"),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await a.waitFor("turn/completed");
	expect(decisions).toEqual([["accept", "acceptPrefixForSession", "decline"]]);
	expect(executed).toBe(0);
	expect(threads.get(thread.id).allowed.has("powershell")).toBe(false);
	expect((await a.readTurns(thread.id))[0].items.find((i) => i.type === "toolCall")).toMatchObject({
		status: "declined",
	});
});

type Asked = { tool: string; prefix?: string; reason?: string; decisions: string[]; input?: { command?: string } };

async function askTurn(answer: (params: Asked) => ApprovalResult) {
	const server = await startServer();
	const a = await server.connect("desktop");
	const asked: Asked[] = [];
	a.client.onRequest("item/toolCall/requestApproval", async (params) => {
		asked.push(params as Asked);
		return answer(params as Asked);
	});
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd, approvalMode: "ask" });
	return { ...server, a, asked, thread };
}

test("bash offers a prefix, never acceptForSession; an allowed prefix skips later asks (§5.4)", async () => {
	const { a, faux, asked, thread } = await askTurn((p) =>
		p.prefix ? { decision: "acceptPrefixForSession" } : { decision: "decline" },
	);
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo one" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo two words" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo three; echo four" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "run them" });
	await a.waitFor("turn/completed");
	expect(asked.map((p) => p.input?.command)).toEqual(["echo one", "echo three; echo four"]);
	expect(asked[0].prefix).toBe("echo");
	expect(asked[0].decisions).toEqual(["accept", "acceptPrefixForSession", "decline"]);
	expect(asked[1].prefix).toBeUndefined();
	expect(asked[1].decisions).toEqual(["accept", "decline"]);
	const [turn] = await a.readTurns(thread.id);
	const calls = turn.items.filter((i) => i.type === "toolCall") as { status: string }[];
	expect(calls.map((c) => c.status)).toEqual(["completed", "completed", "declined"]);
});

test("an answer the server did not offer is treated as decline", async () => {
	const { a, faux, thread } = await askTurn(() => ({ decision: "acceptForSession" }));
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo one" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "run it" });
	await a.waitFor("turn/completed");
	const [turn] = await a.readTurns(thread.id);
	expect((turn.items.find((i) => i.type === "toolCall") as { status: string }).status).toBe("declined");
});

test("a decline with a message blocks with that message", async () => {
	const { a, faux, thread } = await askTurn(() => ({ decision: "decline", message: "use pnpm" }));
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo npm" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "install" });
	await a.waitFor("turn/completed");
	const [turn] = await a.readTurns(thread.id);
	const call = turn.items.find((i) => i.type === "toolCall") as { status: string; output: { text?: string }[] };
	expect(call.status).toBe("declined");
	expect(call.output[0].text).toBe("The user rejected this tool call: use pnpm");
});

test("an edit outside the thread's cwd carries a reason; one inside does not", async () => {
	const { a, faux, asked, thread, cwd } = await askTurn(() => ({ decision: "decline" }));
	const elsewhere = mkdtempSync(join(tmpdir(), "kc-outside-"));
	temporaryDirs.push(elsewhere);
	writeFileSync(join(elsewhere, "x.txt"), "a\n");
	writeFileSync(join(cwd, "y.txt"), "a\n");
	faux.setResponses([
		fauxAssistantMessage(
			[fauxToolCall("edit", { path: join(elsewhere, "x.txt"), edits: [{ oldText: "a", newText: "b" }] })],
			{
				stopReason: "toolUse",
			},
		),
		fauxAssistantMessage([fauxToolCall("edit", { path: "y.txt", edits: [{ oldText: "a", newText: "b" }] })], {
			stopReason: "toolUse",
		}),
		// The edit tool expands `~`: outside the workspace although `resolve()` would place it inside.
		fauxAssistantMessage(
			[fauxToolCall("edit", { path: "~/kc-never-written.txt", edits: [{ oldText: "a", newText: "b" }] })],
			{
				stopReason: "toolUse",
			},
		),
		// A file whose name starts with two dots is inside the workspace.
		fauxAssistantMessage([fauxToolCall("edit", { path: "..notes.txt", edits: [{ oldText: "a", newText: "b" }] })], {
			stopReason: "toolUse",
		}),
		fauxAssistantMessage([fauxText("ok")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "edit them" });
	await a.waitFor("turn/completed");
	expect(asked.map((p) => p.reason)).toEqual([
		"Writes outside this thread's workspace",
		undefined,
		"Writes outside this thread's workspace",
		undefined,
	]);
	expect(asked[1].decisions).toContain("acceptForSession");
});
