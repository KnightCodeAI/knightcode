import { fauxAssistantMessage } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import type { ExtensionAPI } from "../../src/index.ts";
import { cleanupServers, startServer } from "./harness.ts";
import { createGate } from "./fixtures/gate-extension.ts";

afterEach(cleanupServers);
function gate() {
	let enter!: () => void;
	let open!: () => void;
	return {
		entered: new Promise<void>((resolve) => (enter = resolve)),
		released: new Promise<void>((resolve) => (open = resolve)),
		enter: () => enter(),
		open: () => open(),
	};
}

for (const kind of ["new", "fork", "switch"] as const)
	test(`${kind} withSession transfers cancellation and starts exactly one target turn with the original token`, async () => {
		let target = "";
		const forward = (api: ExtensionAPI) => {
			api.registerCommand("forward", {
				handler: async (_args, ctx) => {
					const withSession = async (replacement: typeof ctx) => replacement.sendUserMessage("forwarded");
					if (kind === "new") await ctx.newSession({ withSession });
					else if (kind === "switch") await ctx.switchSession(target, { withSession });
					else {
						const user = ctx.sessionManager
							.getBranch()
							.find((entry) => entry.type === "message" && entry.message.role === "user")!;
						await ctx.fork(user.id, { position: "at", withSession });
					}
				},
			});
		};
		const server = await startServer({ extraExtensions: [forward] });
		const a = await server.connect();
		const { thread: source } = await a.client.request("thread/start", { cwd: server.cwd });
		server.faux.setResponses([fauxAssistantMessage("saved"), fauxAssistantMessage("target response")]);
		await a.client.request("turn/start", { threadId: source.id, text: "save source" });
		await a.waitFor("turn/completed");
		if (kind === "switch") {
			const { thread: destination } = await a.client.request("thread/start", { cwd: server.cwd });
			server.faux.setResponses([fauxAssistantMessage("saved target")]);
			await a.client.request("turn/start", { threadId: destination.id, text: "save target" });
			await a.waitFor("turn/completed", (params) => (params.turn as { threadId: string }).threadId === destination.id);
			target = server.threads.get(destination.id).file!;
		}
		server.faux.setResponses([fauxAssistantMessage("target response")]);
		const notes = a.notifications.length;
		const result = await a.client.request("turn/start", {
			threadId: source.id,
			text: "/forward",
			requestId: "original-token",
		});
		expect(result).toMatchObject({ status: "started", requestId: "original-token" });
		expect(result.threadId).not.toBe(source.id);
		const started = await a.waitFor("turn/started", (params) => params.requestId === "original-token");
		expect(started.turn).toMatchObject({ threadId: result.threadId });
		await a.waitFor("turn/completed", (params) => (params.turn as { threadId: string }).threadId === result.threadId);
		expect(a.notifications.slice(notes).filter((note) => note.method === "turn/started")).toHaveLength(1);
		expect(server.threads.get(result.threadId).pendingStarts.size).toBe(0);
		expect(server.threads.get(result.threadId).reservedStart).toBeUndefined();
	});

test("interrupt during target loading stays cancelled after replacement, without a forwarded run", async () => {
	const loadGate = createGate(1);
	const forward = (api: ExtensionAPI) => {
		api.registerCommand("forward", {
			handler: async (_args, ctx) => {
				await ctx.newSession({ withSession: async (replacement) => replacement.sendUserMessage("never") });
			},
		});
	};
	const server = await startServer({ extraExtensions: [forward, loadGate.extension] });
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage("unused")]);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "/forward" });
	await loadGate.entered;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	loadGate.open();
	const result = await starting;
	expect(result.status).toBe("cancelled");
	expect(a.notifications.some((note) => note.method === "turn/started")).toBe(false);
	expect(server.threads.get(result.threadId).pendingStarts.size).toBe(0);
	expect(server.threads.get(result.threadId).reservedStart).toBeUndefined();
	expect(server.faux.getPendingResponseCount()).toBe(1);
});

for (const stage of ["setup", "input"] as const)
	test(`interrupt during replacement ${stage} cancels the same controller and releases reservations`, async () => {
		const hold = gate();
		const forward = (api: ExtensionAPI) => {
			if (stage === "input")
				api.on("input", async (event) => {
					if (event.text !== "forwarded") return;
					hold.enter();
					await hold.released;
				});
			api.registerCommand("forward", {
				handler: async (_args, ctx) => {
					await ctx.newSession({
						setup:
							stage === "setup"
								? async () => {
										hold.enter();
										await hold.released;
									}
								: undefined,
						withSession: async (replacement) => replacement.sendUserMessage("forwarded"),
					});
				},
			});
		};
		const server = await startServer({ extraExtensions: [forward] });
		const a = await server.connect();
		const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
		server.faux.setResponses([fauxAssistantMessage("unused")]);
		const starting = a.client.request("turn/start", { threadId: thread.id, text: "/forward" });
		await hold.entered;
		const replaced = await a.waitFor("thread/replaced");
		const target = (replaced.thread as { id: string }).id;
		await expect(a.client.request("turn/start", { threadId: target, text: "cannot overtake" })).rejects.toMatchObject({
			code: "turnInProgress",
		});
		let settingsApplied = false;
		const updating = a.client
			.request("thread/settings/update", { threadId: target, thinkingLevel: "high" })
			.then(() => {
				settingsApplied = true;
			});
		await Promise.resolve();
		expect(settingsApplied).toBe(false);
		await a.client.request("turn/interrupt", { threadId: target });
		hold.open();
		expect(await starting).toMatchObject({ status: "cancelled", threadId: target });
		await updating;
		expect(server.threads.get(target).reservedStart).toBeUndefined();
		expect(server.threads.get(target).pendingStarts.size).toBe(0);
		expect(a.notifications.some((note) => note.method === "turn/started")).toBe(false);
	});

test("real /plan approve fresh hands off one target turn rather than cancelling it during old-session disposal", async () => {
	const server = await startServer();
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	server.threads.get(thread.id).session.sessionManager.appendCustomEntry("plan-mode", {
		mode: "planning",
		draft: { revision: 1, markdown: "Implement the task" },
	});
	server.faux.setResponses([fauxAssistantMessage("implemented")]);
	const result = await a.client.request("turn/start", {
		threadId: thread.id,
		text: "/plan approve fresh",
		requestId: "plan-token",
	});
	expect(result.status).toBe("started");
	expect(result.threadId).not.toBe(thread.id);
	await a.waitFor("turn/completed", (params) => (params.turn as { threadId: string }).threadId === result.threadId);
	expect(a.notifications.filter((note) => note.method === "turn/started")).toHaveLength(1);
	expect(a.notifications.find((note) => note.method === "turn/started")?.params.requestId).toBe("plan-token");
});
