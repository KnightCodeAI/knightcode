import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import type { QuestionsUI } from "@knightcode/tools/ask/tool";
import { Type } from "typebox";
import { afterEach, expect, test } from "vitest";
import type { ExtensionContext } from "../../src/core/extensions/types.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

/** A server whose `probe` tool runs `body` with the tool context and returns what it gives back. */
async function probeServer(body: (ctx: ExtensionContext, signal: AbortSignal | undefined) => Promise<unknown>) {
	return startServer({
		extraExtensions: [
			{
				name: "probe",
				factory: (k) => {
					k.registerTool({
						name: "probe",
						label: "Probe",
						description: "test tool",
						parameters: Type.Object({}),
						execute: async (_id, _params, signal, _update, ctx) => ({
							content: [{ type: "text", text: JSON.stringify(await body(ctx, signal)) }],
							details: {},
						}),
					});
				},
			},
		],
	});
}

async function probeTurn(server: Awaited<ReturnType<typeof probeServer>>, mode: "desktop" | "tui" = "desktop") {
	const a = await server.connect(mode);
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd, approvalMode: "fullAccess" });
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("probe", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	return { a, thread };
}

const probeOutput = async (a: Awaited<ReturnType<typeof probeTurn>>["a"], threadId: string) => {
	const [turn] = await a.readTurns(threadId);
	const call = turn.items.find((i) => i.type === "toolCall") as { output: { text: string }[] };
	return JSON.parse(call.output[0].text) as unknown;
};

test("desktop threads answer select, confirm, input and editor through ui/dialog (§8.1)", async () => {
	const server = await probeServer(async (ctx) => [
		ctx.hasUI,
		await ctx.ui.select("Which name?", ["helpers", "utils"]),
		await ctx.ui.confirm("Classifier gate: bash", "Allow this call?"),
		await ctx.ui.input("Branch name", "feature/…"),
		await ctx.ui.editor("Commit message", "fix: "),
	]);
	const { a, thread } = await probeTurn(server);
	const asked: unknown[] = [];
	a.client.onRequest("ui/dialog", async (params) => {
		asked.push(params);
		switch (params.kind) {
			case "select":
				return { value: params.options![1] };
			case "confirm":
				return { confirmed: true };
			case "input":
				return { value: "kc/dialogs" };
			default:
				return { value: `${params.prefill}dialogs` };
		}
	});
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await a.waitFor("turn/completed");
	expect(asked).toEqual([
		{ threadId: thread.id, kind: "select", title: "Which name?", options: ["helpers", "utils"] },
		{ threadId: thread.id, kind: "confirm", title: "Classifier gate: bash", message: "Allow this call?" },
		{ threadId: thread.id, kind: "input", title: "Branch name", placeholder: "feature/…" },
		{ threadId: thread.id, kind: "editor", title: "Commit message", prefill: "fix: " },
	]);
	expect(await probeOutput(a, thread.id)).toEqual([true, "utils", true, "kc/dialogs", "fix: dialogs"]);
});

test("ask_user's questions reach a desktop client all at once, tied to their call and turn", async () => {
	const questions = [
		{ id: "name", question: "Which name?", options: [{ label: "helpers (Recommended)", description: "Shared." }] },
		{ id: "style", question: "Which style?", options: [{ label: "kebab-case", description: "Hyphens." }] },
	];
	// The capability ask_user looks for has to survive the runner's wrapping of the UI context.
	const server = await probeServer(async (ctx) => {
		const panel = ctx.ui as Partial<QuestionsUI>;
		return typeof panel.askQuestions === "function"
			? panel.askQuestions(questions, { toolCallId: "probe-call" })
			: "no panel";
	});
	const { a, thread } = await probeTurn(server);
	const asked: Record<string, unknown>[] = [];
	a.client.onRequest("item/toolCall/requestUserInput", async (params) => {
		asked.push(params);
		return { answers: { name: { label: "helpers (Recommended)" }, style: { other: "snake_case" } } };
	});
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await a.waitFor("turn/completed");
	expect(asked).toEqual([
		{ threadId: thread.id, turnId: expect.stringMatching(/.+/), itemId: "probe-call", questions },
	]);
	expect(await probeOutput(a, thread.id)).toEqual({
		name: { label: "helpers (Recommended)" },
		style: { other: "snake_case" },
	});
});

test("a cancelled dialog reads as nothing chosen, and the thread waits on a dialog meanwhile", async () => {
	const server = await probeServer(async (ctx) => [
		await ctx.ui.select("Pick", ["a", "b"]),
		await ctx.ui.confirm("Sure?", "Really?"),
	]);
	const { a, thread } = await probeTurn(server);
	const sidebar = await server.connect("desktop");
	a.client.onRequest("ui/dialog", async () => {
		await sidebar.waitFor("thread/status/changed", (p) =>
			((p.status as { waitingOn?: string[] }).waitingOn ?? []).includes("dialog"),
		);
		return {};
	});
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await a.waitFor("turn/completed");
	expect(await probeOutput(a, thread.id)).toEqual([null, false]);
});

test("notify reaches subscribers as ui/notify", async () => {
	const server = await probeServer(async (ctx) => {
		ctx.ui.notify("Downloaded model", "warning");
		return "ok";
	});
	const { a, thread } = await probeTurn(server);
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	expect(await a.waitFor("ui/notify")).toEqual({ threadId: thread.id, message: "Downloaded model", level: "warning" });
});

test("interrupting the turn withdraws an open dialog", async () => {
	const server = await probeServer(async (ctx, signal) => ctx.ui.select("Pick", ["a"], { signal }));
	const { a, thread } = await probeTurn(server);
	let asked!: () => void;
	const opened = new Promise<void>((resolve) => (asked = resolve));
	a.client.onRequest("ui/dialog", () => {
		asked();
		return new Promise(() => {});
	});
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await opened;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	await a.waitFor("serverRequest/cancelled");
	await a.waitFor("turn/completed");
});

test("terminal-mode threads have no dialogs until local handles exist (§7.3)", async () => {
	const server = await probeServer(async (ctx) => ctx.hasUI);
	const { a, thread } = await probeTurn(server, "tui");
	await a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await a.waitFor("turn/completed");
	expect(await probeOutput(a, thread.id)).toBe(false);
});
