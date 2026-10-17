import { readFileSync } from "node:fs";
import { fauxAssistantMessage } from "@knightcode/ai";
import { afterEach, expect, test, vi } from "vitest";
import { cleanupServers, startServer } from "./harness.ts";

function gate() {
	let enter!: () => void;
	let open!: () => void;
	return {
		entered: new Promise<void>((r) => {
			enter = r;
		}),
		released: new Promise<void>((r) => {
			open = r;
		}),
		enter: () => enter(),
		open: () => open(),
	};
}
afterEach(async () => {
	vi.restoreAllMocks();
	await cleanupServers();
});

function seedPreflightCompaction(server: Awaited<ReturnType<typeof startServer>>, threadId: string) {
	const session = server.threads.get(threadId).session;
	session.settingsManager.applyOverrides({ compaction: { enabled: true, keepRecentTokens: 1 } });
	session.sessionManager.appendMessage({ role: "user", content: "older context ".repeat(1000), timestamp: Date.now() });
	const old = fauxAssistantMessage("old answer");
	old.provider = server.faux.provider.id;
	old.model = server.faux.getModel().id;
	old.usage.input = server.faux.getModel().contextWindow - 1;
	old.usage.totalTokens = old.usage.input;
	session.sessionManager.appendMessage(old);
	session.sessionManager.appendMessage({ role: "user", content: "recent context", timestamp: Date.now() });
	session.refreshContext();
	return session;
}

test("a cancelled replacement cannot publish later, and newer work runs on the source thread", async () => {
	const hold = gate();
	let loads = 0;
	const server = await startServer({
		tokensPerSecond: 50,
		extraExtensions: [
			{
				name: "forward",
				factory: async (k) => {
					if (++loads === 2) {
						hold.enter();
						await hold.released;
					}
					k.registerCommand("forward", {
						handler: async (_args, ctx) => {
							await ctx.newSession({ withSession: (next) => next.sendUserMessage("forwarded") });
						},
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "/forward" });
	await hold.entered;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	expect(await starting).toMatchObject({ status: "cancelled", threadId: thread.id });
	server.faux.setResponses([fauxAssistantMessage("new source work ".repeat(100))]);
	// The cancelled command still holds the thread's queue until its replacement load returns.
	const newWork = a.client.request("turn/start", { threadId: thread.id, text: "new work" });
	hold.open();
	expect(await newWork).toMatchObject({ status: "started", threadId: thread.id });
	await a.waitFor("item/agentMessage/delta");
	await vi.waitFor(() => expect((server.threads as unknown as { loading: Map<string, unknown> }).loading.size).toBe(0));
	try {
		expect(server.threads.get(thread.id).session.isStreaming).toBe(true);
		expect(a.notifications.some((n) => n.method === "thread/replaced")).toBe(false);
	} finally {
		await a.client.request("turn/interrupt", { threadId: thread.id });
	}
});

test("released cancelled input cannot compact, invoke later hooks or mutate the transcript", async () => {
	const hold = gate();
	let laterHooks = 0;
	const server = await startServer({
		extraExtensions: [
			{
				name: "hold-input",
				factory: (k) => {
					k.on("input", async () => {
						hold.enter();
						await hold.released;
						return { action: "continue" as const };
					});
					k.on("before_agent_start", () => {
						laterHooks++;
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const session = server.threads.get(thread.id).session;
	session.sessionManager.appendMessage(fauxAssistantMessage("saved assistant"));
	session.refreshContext();
	const before = readFileSync(session.sessionManager.getSessionFile()!, "utf8");
	const compact = vi
		.spyOn(session as unknown as { _checkCompaction(): Promise<boolean> }, "_checkCompaction")
		.mockResolvedValue(false);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await hold.entered;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	expect(await starting).toMatchObject({ status: "cancelled" });
	hold.open();
	await new Promise<void>((r) => setImmediate(r));
	expect(compact).not.toHaveBeenCalled();
	expect(laterHooks).toBe(0);
	expect(readFileSync(session.sessionManager.getSessionFile()!, "utf8")).toBe(before);
});

test("interrupt during preflight compaction aborts it and the run ends interrupted", async () => {
	const hold = gate();
	let compactSignal: AbortSignal | undefined;
	const server = await startServer({
		extraExtensions: [
			{
				name: "hold-compact",
				factory: (k) => {
					k.on("session_before_compact", async (event) => {
						compactSignal = event.signal;
						hold.enter();
						await hold.released;
						return {
							compaction: {
								summary: "must not persist",
								firstKeptEntryId: event.preparation.firstKeptEntryId,
								tokensBefore: event.preparation.tokensBefore,
							},
						};
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const session = seedPreflightCompaction(server, thread.id);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await hold.entered;
	try {
		await a.client.request("turn/interrupt", { threadId: thread.id });
		expect(compactSignal?.aborted).toBe(true);
		// The run was being prepared, so it exists and stops at once (architecture.md 4.7).
		expect(await starting).toMatchObject({ status: "started" });
		const { turn } = await a.waitFor("turn/completed");
		expect(turn).toMatchObject({ status: "interrupted" });
	} finally {
		hold.open();
	}
	await vi.waitFor(() => expect(session.isCompacting).toBe(false));
	expect(session.sessionManager.getEntries().some((e) => e.type === "compaction")).toBe(false);
});

test("a start interrupted during its input hooks answers at once and launches no run", async () => {
	const hold = gate();
	const server = await startServer({
		extraExtensions: [
			{
				name: "chain",
				factory: (k) => {
					k.on("input", async () => {
						hold.enter();
						await hold.released;
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage("must remain unused")]);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await hold.entered;
	await a.client.request("turn/interrupt", { threadId: thread.id });
	expect(await starting).toMatchObject({ status: "cancelled" });
	hold.open();
	await vi.waitFor(() => expect(server.threads.get(thread.id).pendingStarts.size).toBe(0));
	expect(server.faux.getPendingResponseCount()).toBe(1);
	expect(a.notifications.some((n) => n.method === "turn/started")).toBe(false);
});

test("a start interrupted during before_agent_start runs only until agent_start", async () => {
	const hold = gate();
	const server = await startServer({
		extraExtensions: [
			{
				name: "chain",
				factory: (k) => {
					k.on("before_agent_start", async () => {
						hold.enter();
						await hold.released;
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage("must remain unused")]);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await hold.entered;
	// The interrupt answers without waiting for the hook.
	await a.client.request("turn/interrupt", { threadId: thread.id });
	hold.open();
	expect(await starting).toMatchObject({ status: "started" });
	const { turn } = await a.waitFor("turn/completed");
	expect(turn).toMatchObject({ status: "interrupted" });
	expect(server.faux.getPendingResponseCount()).toBe(1);
});

test("unloading during a gated settlement still completes the accepted mapped turn", async () => {
	const hold = gate();
	const server = await startServer({
		extraExtensions: [
			{
				name: "hold-settled",
				factory: (k) => {
					k.on("agent_settled", async () => {
						hold.enter();
						await hold.released;
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage("first")]);
	await a.client.request("turn/start", { threadId: thread.id, text: "first" });
	await hold.entered;
	try {
		await server.threads.unload(thread.id);
		expect(a.notifications.filter((n) => n.method === "turn/completed")).toHaveLength(1);
	} finally {
		hold.open();
	}
});

test("external admission while agent_settled is gated cannot return handled then launch a deferred turn", async () => {
	const hold = gate();
	const server = await startServer({
		extraExtensions: [
			{
				name: "hold-settled",
				factory: (k) => {
					k.on("agent_settled", async () => {
						hold.enter();
						await hold.released;
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("must remain unused")]);
	await a.client.request("turn/start", { threadId: thread.id, text: "first" });
	await hold.entered;
	try {
		await expect(
			a.client.request("turn/start", { threadId: thread.id, text: "second", requestId: "second-token" }),
		).rejects.toMatchObject({ code: "turnInProgress" });
	} finally {
		hold.open();
	}
	await server.threads.get(thread.id).session.waitForIdle();
	expect(server.faux.getPendingResponseCount()).toBe(1);
	expect(a.notifications.filter((n) => n.method === "turn/started")).toHaveLength(1);
});

test("deferred settlement preflight keeps external admission closed until dispatch finishes", async () => {
	const hold = gate();
	let queued = false;
	const server = await startServer({
		extraExtensions: [
			{
				name: "deferred-settlement",
				factory: (k) => {
					k.on("agent_settled", () => {
						if (!queued) {
							queued = true;
							k.sendUserMessage("deferred");
						}
					});
					k.on("before_agent_start", async (event) => {
						if (event.messageType === "user" && event.prompt === "deferred") {
							hold.enter();
							await hold.released;
						}
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage("first"), fauxAssistantMessage("deferred")]);
	await a.client.request("turn/start", { threadId: thread.id, text: "first" });
	await hold.entered;
	try {
		await expect(a.client.request("turn/start", { threadId: thread.id, text: "external" })).rejects.toMatchObject({
			code: "turnInProgress",
		});
	} finally {
		hold.open();
	}
	await vi.waitFor(() => expect(a.notifications.filter((n) => n.method === "turn/completed")).toHaveLength(2));
	expect(server.faux.getPendingResponseCount()).toBe(0);
});

test("cancelled model preservation cannot overwrite newer target model and thinking selections", async () => {
	const hold = gate();
	const server = await startServer({
		extraExtensions: [
			{
				name: "preserve-selection",
				factory: (k) => {
					k.registerCommand("preserve", {
						handler: async (_args, ctx) => {
							await ctx.newSession({ preserveModel: true });
						},
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	await a.client.request("thread/settings/update", { threadId: thread.id, thinkingLevel: "low" });
	const original = server.ctx.models.checkAuth.bind(server.ctx.models);
	vi.spyOn(server.ctx.models, "checkAuth").mockImplementation(async (provider) => {
		hold.enter();
		await hold.released;
		return original(provider);
	});
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "/preserve" });
	await hold.entered;
	const replacement = await a.waitFor("thread/replaced");
	const targetId = (replacement.thread as { id: string }).id;
	const target = server.threads.get(targetId);
	try {
		await a.client.request("turn/interrupt", { threadId: targetId });
		expect(await starting).toMatchObject({ status: "cancelled", threadId: targetId });
		vi.restoreAllMocks();
		// A different virtual selection makes a model overwrite observable without live auth.
		const model = { provider: server.faux.provider.id, id: "newer-selection", name: "Newer selection" };
		server.ctx.models.registerVirtualModel({
			...model,
			thinkingLevels: ["off", "low", "high"],
			route: () => ({ model: server.faux.getModel(), thinkingLevel: "off" }),
		});
		await a.client.request("thread/settings/update", {
			threadId: targetId,
			model: { provider: model.provider, id: model.id },
			thinkingLevel: "high",
		});
		hold.open();
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(target.session.model?.id).toBe(model.id);
		expect(target.session.thinkingLevel).toBe("high");
	} finally {
		hold.open();
	}
});

test("a prompt during another prompt's preflight is rejected without touching that run", async () => {
	const hold = gate();
	const server = await startServer({
		tokensPerSecond: 50,
		extraExtensions: [
			{
				name: "overlapping-preflight",
				factory: (k) => {
					k.on("before_agent_start", async (event) => {
						if (event.messageType === "user" && event.prompt === "blocked") {
							hold.enter();
							await hold.released;
							event.systemPromptOptions.selectedTools = [];
							return { systemPrompt: "blocked override" };
						}
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const session = server.threads.get(thread.id).session;
	server.faux.setResponses([fauxAssistantMessage("blocked reply")]);
	const blocked = session.prompt("blocked");
	await hold.entered;
	try {
		// The run counts as busy from its preflight on, so the second prompt cannot start a run of its own.
		await expect(session.prompt("running")).rejects.toThrow("already processing");
	} finally {
		hold.open();
	}
	await blocked;
	await a.waitFor("turn/completed");
});

test.each(["new", "fork", "switch"] as const)(
	"a %s cancelled in its pre-hooks does not replace the thread",
	async (kind) => {
		const hold = gate();
		let late = 0;
		let forkId = "";
		let targetFile = "";
		const server = await startServer({
			extraExtensions: [
				{
					name: "replacement-chain",
					factory: (k) => {
						const before = async () => {
							hold.enter();
							await hold.released;
						};
						const later = () => {
							late++;
						};
						if (kind === "fork") {
							k.on("session_before_fork", before);
							k.on("session_before_fork", later);
						} else {
							k.on("session_before_switch", before);
							k.on("session_before_switch", later);
						}
						k.registerCommand("replace", {
							handler: async (_args, ctx) => {
								if (kind === "new") await ctx.newSession();
								else if (kind === "fork") await ctx.fork(forkId, { position: "at" });
								else await ctx.switchSession(targetFile);
							},
						});
					},
				},
			],
		});
		const a = await server.connect();
		const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
		const session = server.threads.get(thread.id).session;
		forkId = session.sessionManager.appendMessage({ role: "user", content: "saved", timestamp: Date.now() });
		session.sessionManager.appendMessage(fauxAssistantMessage("saved answer"));
		session.refreshContext();
		if (kind === "switch") {
			const target = await a.client.request("thread/start", { cwd: server.cwd });
			targetFile = server.threads.get(target.thread.id).file!;
		}
		const starting = a.client.request("turn/start", { threadId: thread.id, text: "/replace" });
		await hold.entered;
		try {
			await a.client.request("turn/interrupt", { threadId: thread.id });
			expect(await starting).toMatchObject({ status: "cancelled" });
			hold.open();
			// Hooks already dispatched run to completion (architecture.md 4.7); the replacement still backs out.
			await vi.waitFor(() => expect(late).toBe(1));
			await vi.waitFor(() => expect(server.threads.get(thread.id).pendingStarts.size).toBe(0));
			expect(a.notifications.some((n) => n.method === "thread/replaced")).toBe(false);
		} finally {
			hold.open();
		}
	},
);

test.each([
	["interrupt", "extension"],
	["unload", "extension"],
	["interrupt", "provider"],
	["unload", "provider"],
	["interrupt", "failure"],
	["unload", "failure"],
] as const)("%s does not wait for a cancelled automatic compaction %s callback", async (kind, stage) => {
	const hold = gate();
	let compactSignal: AbortSignal | undefined;
	const server = await startServer({
		extraExtensions: [
			{
				name: "noncooperative-compact",
				factory: (k) => {
					const wait = async () => {
						hold.enter();
						await hold.released;
					};
					if (stage === "failure") k.on("session_compact_failed", wait);
					else if (stage === "extension")
						k.on("session_before_compact", async (event) => {
							compactSignal = event.signal;
							await wait();
						});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const session = seedPreflightCompaction(server, thread.id);
	if (stage !== "extension")
		vi.spyOn(
			session as unknown as {
				_runDefaultCompaction(): Promise<{ summary: string; firstKeptEntryId: string; tokensBefore: number }>;
			},
			"_runDefaultCompaction",
		).mockImplementation(async () => {
			if (stage === "failure") throw new Error("fixture compaction failure");
			hold.enter();
			await hold.released;
			return {
				summary: "must not persist",
				firstKeptEntryId: session.sessionManager.getBranch()[0].id,
				tokensBefore: 1,
			};
		});
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await hold.entered;
	const remove = compactSignal ? vi.spyOn(compactSignal, "removeEventListener") : undefined;
	let finished = false;
	const stopping = (
		kind === "interrupt"
			? a.client.request("turn/interrupt", { threadId: thread.id })
			: server.threads.unload(thread.id)
	).then(() => {
		finished = true;
	});
	try {
		// Unload cancels the start; an interrupt stops the run it was preparing (architecture.md 4.7).
		expect(await starting).toMatchObject({ status: kind === "unload" ? "cancelled" : "started" });
		await vi.waitFor(() => expect(finished).toBe(true), { timeout: 1000 });
		expect(session.isCompacting).toBe(false);
		if (remove) expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
		if (kind === "unload") expect(server.threads.loadedCount()).toBe(0);
	} finally {
		hold.open();
		await stopping;
	}
});

test("an interrupted default summary makes no live provider request", async () => {
	const hold = gate();
	const server = await startServer({
		extraExtensions: [
			{
				name: "summary-headers",
				factory: (k) => {
					k.on("before_provider_headers", async () => {
						hold.enter();
						await hold.released;
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	const session = seedPreflightCompaction(server, thread.id);
	server.faux.setResponses([fauxAssistantMessage("must not generate a summary")]);
	const starting = a.client.request("turn/start", { threadId: thread.id, text: "go" });
	await hold.entered;
	const calls: (boolean | undefined)[] = [];
	const original = server.ctx.models.streamSimple.bind(server.ctx.models);
	vi.spyOn(server.ctx.models, "streamSimple").mockImplementation((model, context, options, owner) => {
		calls.push(options?.signal?.aborted);
		return original(model, context, options, owner);
	});
	try {
		await a.client.request("turn/interrupt", { threadId: thread.id });
		expect(await starting).toMatchObject({ status: "started" });
		hold.open();
		await a.waitFor("turn/completed");
		await vi.waitFor(() => expect(session.isCompacting).toBe(false));
		// The summary request and the stopped run may still reach the provider, but only already aborted.
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every((aborted) => aborted === true)).toBe(true);
		expect(session.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
	} finally {
		hold.open();
		await starting;
	}
});

test("idle unloading rearms after a deferred settlement prompt is handled without launching a run", async () => {
	const hold = gate();
	let queued = false;
	const server = await startServer({
		idleMs: 10,
		extraExtensions: [
			{
				name: "handled-deferred-settlement",
				factory: (k) => {
					k.on("agent_settled", () => {
						if (!queued) {
							queued = true;
							k.sendUserMessage("deferred");
						}
					});
					k.on("input", async (event) => {
						if (event.text === "deferred") {
							hold.enter();
							await hold.released;
							return { action: "handled" as const };
						}
					});
				},
			},
		],
	});
	const a = await server.connect();
	const { thread } = await a.client.request("thread/start", { cwd: server.cwd });
	server.faux.setResponses([fauxAssistantMessage("first")]);
	await a.client.request("turn/start", { threadId: thread.id, text: "first" });
	await hold.entered;
	try {
		const session = server.threads.get(thread.id).session;
		expect(session.isIdle).toBe(true);
		expect(session.isSettling).toBe(true);
		// Hook-facing idle semantics must remain unchanged; the external fully-idle wait must remain pending.
		await session.waitForIdle();
		let drained = false;
		const fullyIdle = session.waitForIdle({ includeSettlement: true }).then(() => {
			drained = true;
		});
		a.close();
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(drained).toBe(false);
		expect(server.threads.loadedCount()).toBe(1);
		hold.open();
		await fullyIdle;
		await vi.waitFor(() => expect(server.threads.loadedCount()).toBe(0));
	} finally {
		hold.open();
	}
});
