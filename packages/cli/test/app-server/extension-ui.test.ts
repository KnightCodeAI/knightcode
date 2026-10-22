import type { Item, View, WireItem } from "@knightcode/app-server-protocol";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@knightcode/ai";
import { Type } from "typebox";
import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "../../src/index.ts";
import desktopView from "../../examples/extensions/desktop-view.ts";
import { createGate } from "./fixtures/gate-extension.ts";
import { cleanupServers, startServer, type TestClient } from "./harness.ts";

afterEach(() => {
	vi.restoreAllMocks();
	return cleanupServers();
});

type Act = (ctx: ExtensionContext) => void | Promise<void>;

/**
 * A server with one extension: `/act` runs whatever the test put in `act`, `session_start` runs `start`, and
 * `session_shutdown` runs `shutdown`.
 */
async function uiServer(hooks: { start?: Act; shutdown?: Act; extra?: ((api: ExtensionAPI) => void)[] } = {}) {
	let act: Act = () => {};
	const extension = (api: ExtensionAPI) => {
		api.registerCommand("act", { handler: async (_args, ctx) => act(ctx) });
		api.on("session_start", async (_event, ctx) => hooks.start?.(ctx));
		api.on("session_shutdown", async (_event, ctx) => hooks.shutdown?.(ctx));
	};
	const server = await startServer({ extraExtensions: [extension, ...(hooks.extra ?? [])] });
	const open = async (mode: "desktop" | "tui" = "desktop") => {
		const a = await server.connect(mode);
		const started = await a.client.request("thread/start", { cwd: server.cwd });
		return { a, ...started };
	};
	/** Run `fn` as a command on the thread; resolves once the command has finished. */
	const run = async (a: TestClient, threadId: string, fn: Act) => {
		act = fn;
		const result = await a.client.request("turn/start", { threadId, text: "/act" });
		expect(result.status).toBe("handled");
	};
	return { server, open, run };
}

const uiNotes = (a: TestClient, from: number) =>
	a.notifications.slice(from).filter((n) => n.method === "ui/state" || n.method === "ui/widget");
const warnings = (a: TestClient, from: number) => a.notifications.slice(from).filter((n) => n.method === "warning");

const table: View = { type: "table", columns: ["test", "result"], rows: [["parser", "failed"]] };

test("statuses, the title and the working row arrive as whole-state ui/state", async () => {
	const { open, run } = await uiServer();
	const { a, thread } = await open();
	const mark = a.notifications.length;
	await run(a, thread.id, (ctx) => {
		ctx.ui.setStatus("tests", "\u001b[32m✓\u001b[0m 42\npassed");
		ctx.ui.setStatus("build", "ok");
		ctx.ui.setTitle("x".repeat(300));
		ctx.ui.setWorkingMessage("Running tests");
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setStatus("build", undefined);
	});
	const notes = uiNotes(a, mark).map((n) => n.params);
	expect(notes).toHaveLength(6);
	const title = `${"x".repeat(199)}…`;
	expect(notes[1]).toEqual({
		threadId: thread.id,
		statuses: [
			{ key: "build", text: "ok" },
			{ key: "tests", text: "✓ 42 passed" },
		],
		workingVisible: true,
	});
	expect(notes[5]).toEqual({
		threadId: thread.id,
		statuses: [{ key: "tests", text: "✓ 42 passed" }],
		title,
		workingMessage: "Running tests",
		workingVisible: false,
	});
	expect([...title].length).toBe(200);
	const again = a.notifications.length;
	await run(a, thread.id, (ctx) => {
		ctx.ui.setStatus("tests", "✓ 42 passed");
		ctx.ui.setTitle("x".repeat(300));
		ctx.ui.setWorkingMessage("Running tests");
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setStatus("gone", undefined);
	});
	expect(uiNotes(a, again)).toEqual([]);
	await run(a, thread.id, (ctx) => {
		ctx.ui.setTitle("");
		ctx.ui.setWorkingMessage();
	});
	expect(uiNotes(a, again).at(-1)?.params).toEqual({
		threadId: thread.id,
		statuses: [{ key: "tests", text: "✓ 42 passed" }],
		workingVisible: false,
	});
});

test("widgets arrive with their placement, are removed, and move last when set again", async () => {
	const { open, run } = await uiServer();
	const { a, thread } = await open();
	const mark = a.notifications.length;
	await run(a, thread.id, (ctx) => {
		ctx.ui.setWidget("first", ["\u001b[1mone\u001b[0m", "  two"]);
		ctx.ui.setWidget("second", table, { placement: "belowEditor" });
		ctx.ui.setWidget("third", ["three"]);
		ctx.ui.setWidget("third", undefined);
		ctx.ui.setWidget("never", undefined);
	});
	expect(uiNotes(a, mark).map((n) => n.params)).toEqual([
		{ threadId: thread.id, key: "first", placement: "aboveEditor", lines: ["one", "  two"] },
		{ threadId: thread.id, key: "second", placement: "belowEditor", view: table },
		{ threadId: thread.id, key: "third", placement: "aboveEditor", lines: ["three"] },
		{ threadId: thread.id, key: "third" },
	]);
	await run(a, thread.id, (ctx) => {
		ctx.ui.setWidget("second", table);
		ctx.ui.setWidget("first", ["one", "  two"]);
	});
	const resumed = await a.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.ui.widgets.map((w) => w.key)).toEqual(["second", "first"]);
	expect(uiNotes(a, mark).at(-1)?.params).toEqual({
		threadId: thread.id,
		key: "first",
		placement: "aboveEditor",
		lines: ["one", "  two"],
	});
});

test("a refused widget or status sends nothing and warns once per key", async () => {
	const { open, run } = await uiServer();
	const { a, thread } = await open();
	const longKey = "k".repeat(129);
	const refusals: [string, Act][] = [
		["bad-view", (ctx) => ctx.ui.setWidget("bad-view", { type: "table", columns: ["a", "b", "c"], rows: [["1"]] })],
		["big-view", (ctx) => ctx.ui.setWidget("big-view", { type: "markdown", markdown: "x".repeat(17 * 1024) })],
		["number-line", (ctx) => ctx.ui.setWidget("number-line", ["one", 2] as unknown as string[])],
		["w16", (ctx) => ctx.ui.setWidget("w16", ["over the limit"])],
		["s50", (ctx) => ctx.ui.setStatus("s50", "over the limit")],
		[longKey.slice(0, 128), (ctx) => ctx.ui.setStatus(longKey, "long key")],
	];
	await run(a, thread.id, (ctx) => {
		for (let i = 0; i < 16; i++) ctx.ui.setWidget(`w${i}`, [`${i}`]);
		for (let i = 0; i < 50; i++) ctx.ui.setStatus(`s${i}`, `${i}`);
	});
	const before = await a.client.request("thread/resume", { threadId: thread.id });
	for (const [key, refuse] of refusals) {
		const mark = a.notifications.length;
		await run(a, thread.id, async (ctx) => {
			for (let i = 0; i < 3; i++) await refuse(ctx);
		});
		expect(uiNotes(a, mark), key).toEqual([]);
		const warned = warnings(a, mark);
		expect(warned, key).toHaveLength(1);
		expect(warned[0].params).toMatchObject({ source: "extension", threadId: thread.id });
		expect(String(warned[0].params.message)).toContain(`"${key}" was not shown`);
	}
	const after = await a.client.request("thread/resume", { threadId: thread.id });
	expect(after.ui).toEqual(before.ui);
});

test("a widget refused while the thread loads is a load warning of thread/start", async () => {
	const { open } = await uiServer({
		start: (ctx) => ctx.ui.setWidget("loading", { type: "table", columns: ["a", "b", "c"], rows: [["1", "2"]] }),
	});
	const { warnings: loaded, ui } = await open();
	expect(loaded).toContainEqual({
		source: "extension",
		message: 'Widget "loading" was not shown: a table row has 2 cells for 3 columns',
	});
	expect(ui.widgets).toEqual([]);
});

test("the server keeps its own copy of a widget's view", async () => {
	const { open, run } = await uiServer();
	const { a, thread } = await open();
	const view = {
		type: "stack" as const,
		children: [{ type: "field" as const, id: "verbose", kind: "toggle" as const, label: "Verbose", value: false }],
	};
	await run(a, thread.id, (ctx) => ctx.ui.setWidget("checks", view));
	const mark = a.notifications.length;
	await run(a, thread.id, (ctx) => {
		view.children[0].value = true;
		ctx.ui.setWidget("checks", view);
		view.children[0].value = false;
		view.children[0].label = "changed after the call";
	});
	const sent = uiNotes(a, mark).map((n) => n.params);
	expect(sent).toHaveLength(1);
	expect(sent[0].view).toEqual({ ...view, children: [{ ...view.children[0], value: true, label: "Verbose" }] });
	const { ui } = await a.client.request("thread/resume", { threadId: thread.id });
	expect(ui.widgets).toEqual([{ key: "checks", placement: "aboveEditor", view: sent[0].view }]);
});

test("terminal-only UI sends nothing and logs once per method", async () => {
	const { open, run } = await uiServer();
	const { a, thread } = await open();
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	const mark = a.notifications.length;
	const results: unknown[] = [];
	await run(a, thread.id, async (ctx) => {
		for (let i = 0; i < 3; i++) {
			ctx.ui.setWidget("factory", () => ({ render: () => [], invalidate: () => {} }));
			results.push(await ctx.ui.custom(() => ({ render: () => [], invalidate: () => {} })));
			ctx.ui.onTerminalInput(() => undefined)();
			ctx.ui.setWorkingIndicator({ frames: ["●"] });
			ctx.ui.setHeader(() => ({ render: () => [], invalidate: () => {} }));
			ctx.ui.setFooter(() => ({ render: () => [], invalidate: () => {} }));
		}
		ctx.ui.setWorkingIndicator();
		ctx.ui.setHeader(undefined);
	});
	expect(uiNotes(a, mark)).toEqual([]);
	expect(results).toEqual([undefined, undefined, undefined]);
	const logged = errors.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("draws only"));
	expect(logged).toEqual(
		[
			'setWidget("factory")',
			"custom()",
			"onTerminalInput()",
			"setWorkingIndicator()",
			"setHeader()",
			"setFooter()",
		].map((call) => `app-server: thread ${thread.id}: ${call} draws only in the terminal; the desktop app ignores it`),
	);
});

test("start, resume and fork return the thread's current ui", async () => {
	let loads = 0;
	const { server, open, run } = await uiServer({
		start: (ctx) => {
			loads++;
			ctx.ui.setStatus("loads", `${loads}`);
			ctx.ui.setWidget("hello", ["hi"], { placement: "belowEditor" });
		},
	});
	const { a, thread, ui } = await open();
	expect(ui).toEqual({
		statuses: [{ key: "loads", text: "1" }],
		workingVisible: true,
		widgets: [{ key: "hello", placement: "belowEditor", lines: ["hi"] }],
	});
	await run(a, thread.id, (ctx) => {
		ctx.ui.setWidget("above", ["first"]);
		ctx.ui.setTitle("watching");
	});
	const b = await server.connect("desktop");
	const resumed = await b.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.ui).toEqual({
		statuses: [{ key: "loads", text: "1" }],
		title: "watching",
		workingVisible: true,
		widgets: [
			{ key: "above", placement: "aboveEditor", lines: ["first"] },
			{ key: "hello", placement: "belowEditor", lines: ["hi"] },
		],
	});
	server.faux.setResponses([fauxAssistantMessage("saved")]);
	await a.client.request("turn/start", { threadId: thread.id, text: "save" });
	await a.waitFor("turn/completed");
	const fork = await a.client.request("thread/fork", { threadId: thread.id });
	expect(fork.ui).toEqual({
		statuses: [{ key: "loads", text: "2" }],
		workingVisible: true,
		widgets: [{ key: "hello", placement: "belowEditor", lines: ["hi"] }],
	});
});

test("a thread a terminal-mode connection loads has an empty ui", async () => {
	const { open } = await uiServer({ start: (ctx) => ctx.ui.setStatus("tests", "ok") });
	const { ui } = await open("tui");
	expect(ui).toEqual({ statuses: [], workingVisible: true, widgets: [] });
});

test("a reload clears the old extensions' UI after their shutdown and before the new session_start", async () => {
	let loads = 0;
	const { server, open, run } = await uiServer({
		start: (ctx) => {
			loads++;
			ctx.ui.setStatus("loads", `${loads}`);
			ctx.ui.setWidget(`w${loads}`, ["x"]);
		},
		shutdown: (ctx) => ctx.ui.setTitle("shutting down"),
	});
	const { a, thread } = await open();
	const mark = a.notifications.length;
	await run(a, thread.id, (ctx) => (ctx as ExtensionContext & { reload(): Promise<void> }).reload());
	expect(uiNotes(a, mark).map((n) => n.params)).toEqual([
		{ threadId: thread.id, statuses: [{ key: "loads", text: "1" }], title: "shutting down", workingVisible: true },
		{ threadId: thread.id, statuses: [], workingVisible: true },
		{ threadId: thread.id, key: "w1" },
		{ threadId: thread.id, statuses: [{ key: "loads", text: "2" }], workingVisible: true },
		{ threadId: thread.id, key: "w2", placement: "aboveEditor", lines: ["x"] },
	]);
	const { ui } = await a.client.request("thread/resume", { threadId: thread.id });
	expect(ui).toEqual({
		statuses: [{ key: "loads", text: "2" }],
		workingVisible: true,
		widgets: [{ key: "w2", placement: "aboveEditor", lines: ["x"] }],
	});

	// A reload whose resource load fails still clears what the old extensions showed.
	vi.spyOn(server.threads.get(thread.id).session.resourceLoader, "reload").mockRejectedValueOnce(new Error("broken"));
	vi.spyOn(console, "error").mockImplementation(() => {});
	const failed = a.notifications.length;
	await run(a, thread.id, async (ctx) => {
		await (ctx as ExtensionContext & { reload(): Promise<void> }).reload().catch(() => {});
	});
	expect(uiNotes(a, failed).map((n) => n.params)).toEqual([
		{ threadId: thread.id, statuses: [{ key: "loads", text: "2" }], title: "shutting down", workingVisible: true },
		{ threadId: thread.id, statuses: [], workingVisible: true },
		{ threadId: thread.id, key: "w2" },
	]);
});

const controls: View = {
	type: "stack",
	children: [
		{ type: "button", id: "reset", label: "Reset" },
		{ type: "field", id: "verbose", kind: "toggle", label: "Verbose", value: false },
		{ type: "field", id: "mode", kind: "select", label: "Mode", value: "fast", options: ["fast", "slow"] },
		{ type: "field", id: "name", kind: "text", label: "Name", value: "" },
	],
};

/** Two extensions, each with a view-event handler that records what it got; `fail` makes the first one fail. */
async function eventServer(fail?: "throw" | "reject") {
	const seen: { a: unknown[]; b: unknown[] } = { a: [], b: [] };
	const listener = (name: "a" | "b") => (api: ExtensionAPI) => {
		api.on("session_start", (_event, ctx) => {
			ctx.ui.onViewEvent?.((event) => {
				seen[name].push(event);
				if (name === "a" && fail === "throw") throw new Error("handler threw");
				if (name === "a" && fail === "reject") return Promise.reject(new Error("handler rejected"));
			});
		});
	};
	const setup = await uiServer({
		start: (ctx) => {
			ctx.ui.setWidget("a", controls);
			ctx.ui.setWidget("lines", ["just text"]);
		},
		extra: [listener("a"), listener("b")],
	});
	const opened = await setup.open();
	/** Every handler has run once its microtask has: one round trip later, nothing is still on the way. */
	const settle = () => opened.a.client.request("thread/list", {});
	return { ...setup, ...opened, seen, settle };
}

test("ui/event reaches every handler of the thread with its widget key", async () => {
	const { a, thread, seen, settle } = await eventServer();
	expect(await a.client.request("ui/event", { threadId: thread.id, widgetKey: "a", id: "reset" })).toEqual({});
	await a.client.request("ui/event", { threadId: thread.id, widgetKey: "a", id: "verbose", value: true });
	await a.client.request("ui/event", { threadId: thread.id, widgetKey: "a", id: "mode", value: "slow" });
	await a.client.request("ui/event", { threadId: thread.id, widgetKey: "a", id: "name", value: "Ada" });
	await settle();
	const expected = [
		{ widgetKey: "a", id: "reset" },
		{ widgetKey: "a", id: "verbose", value: true },
		{ widgetKey: "a", id: "mode", value: "slow" },
		{ widgetKey: "a", id: "name", value: "Ada" },
	];
	expect(seen.a).toEqual(expected);
	expect(seen.b).toEqual(expected);
});

test("a value that does not fit its control answers invalidParams and delivers nothing", async () => {
	const { a, thread, seen, settle } = await eventServer();
	for (const [id, value] of [
		["verbose", "on"],
		["mode", "medium"],
		["mode", true],
		["name", false],
		["reset", "pressed"],
	] as const) {
		await expect(
			a.client.request("ui/event", { threadId: thread.id, widgetKey: "a", id, value }),
			`${id}=${value}`,
		).rejects.toMatchObject({ code: "invalidParams" });
	}
	await settle();
	expect(seen.a).toEqual([]);
});

test("a stale press answers {} and delivers nothing", async () => {
	const { a, thread, seen, settle } = await eventServer();
	for (const [widgetKey, id] of [
		["a", "missing"],
		["never-set", "reset"],
		["lines", "reset"],
	]) {
		expect(await a.client.request("ui/event", { threadId: thread.id, widgetKey, id })).toEqual({});
	}
	await settle();
	expect(seen.a).toEqual([]);
});

for (const fail of ["throw", "reject"] as const)
	test(`a handler that fails (${fail}) gives one warning and the others still run`, async () => {
		const { a, thread, seen, settle } = await eventServer(fail);
		vi.spyOn(console, "error").mockImplementation(() => {});
		const mark = a.notifications.length;
		await a.client.request("ui/event", { threadId: thread.id, widgetKey: "a", id: "reset" });
		await settle();
		expect(seen.b).toEqual([{ widgetKey: "a", id: "reset" }]);
		const warned = warnings(a, mark).map((n) => n.params);
		expect(warned).toEqual([
			{
				source: "extension",
				threadId: thread.id,
				message: `A view event handler failed: handler ${fail === "throw" ? "threw" : "rejected"}`,
			},
		]);
	});

test("after a reload the old handlers hear nothing", async () => {
	const { a, thread, seen, settle, run } = await eventServer();
	await run(a, thread.id, (ctx) => (ctx as ExtensionContext & { reload(): Promise<void> }).reload());
	await a.client.request("ui/event", { threadId: thread.id, widgetKey: "a", id: "reset" });
	await settle();
	// The reloaded extensions registered new handlers: each hears the press once, the invalidated ones never.
	expect(seen.a).toEqual([{ widgetKey: "a", id: "reset" }]);
	expect(seen.b).toEqual([{ widgetKey: "a", id: "reset" }]);
});

test("a press while the reload is held in a new extension's factory reaches no handler", async () => {
	const gate = createGate(1);
	const seen: unknown[] = [];
	const { open, run } = await uiServer({
		start: (ctx) => {
			ctx.ui.setWidget("a", controls);
			ctx.ui.onViewEvent?.((event) => {
				seen.push(event);
			});
		},
		extra: [gate.extension],
	});
	const { a, thread } = await open();
	const reloading = run(a, thread.id, (ctx) => (ctx as ExtensionContext & { reload(): Promise<void> }).reload());
	await gate.entered;
	expect(await a.client.request("ui/event", { threadId: thread.id, widgetKey: "a", id: "reset" })).toEqual({});
	gate.open();
	await reloading;
	await a.client.request("thread/list", {});
	expect(seen).toEqual([]);
});

test("ui/event for a thread that is not loaded answers threadNotFound", async () => {
	const { server } = await uiServer();
	const a = await server.connect("desktop");
	await expect(
		a.client.request("ui/event", { threadId: "019a0000-0000-7000-8000-000000000000", widgetKey: "a", id: "reset" }),
	).rejects.toMatchObject({ code: "threadNotFound" });
});

/** A server whose `check` tool returns `details` (and `text`), and whose `outer` tool runs `check` nested. */
async function viewServer(details: unknown, text = "RAW OUTPUT") {
	let sendMessage!: ExtensionAPI["sendMessage"];
	const tools = (api: ExtensionAPI) => {
		sendMessage = (...args) => api.sendMessage(...args);
		api.registerTool({
			name: "check",
			label: "Check",
			description: "test tool",
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text", text }], details }),
		});
		api.registerTool({
			name: "outer",
			label: "Outer",
			description: "test tool",
			parameters: Type.Object({}),
			execute: async (_id, _params, _signal, _update, ctx) => {
				await ctx.executeTool("check", {});
				return { content: [{ type: "text", text: "outer done" }], details: {} };
			},
		});
	};
	const setup = await uiServer({ extra: [tools] });
	const opened = await setup.open();
	await opened.a.client.request("thread/settings/update", { threadId: opened.thread.id, approvalMode: "fullAccess" });
	/** One turn calling `tool`; resolves with its top-level item/completed for that call. */
	const call = async (tool: string) => {
		setup.server.faux.setResponses([
			fauxAssistantMessage([fauxToolCall(tool, {})], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("done")]),
		]);
		await opened.a.client.request("turn/start", { threadId: opened.thread.id, text: "go" });
		await opened.a.waitFor("turn/completed");
	};
	const completed = async (predicate: (item: Item) => boolean) => {
		for (const n of opened.a.notifications) {
			if (n.method !== "item/completed") continue;
			const item = await opened.a.client.resolveItem(n.params.item as WireItem);
			if (predicate(item)) return { item, wire: n.params.item as WireItem };
		}
		throw new Error("no such item/completed");
	};
	const readBack = async () => (await opened.a.readTurns(opened.thread.id)).flatMap((turn) => turn.items);
	return {
		...setup,
		...opened,
		call,
		completed,
		readBack,
		sendMessage: (...args: Parameters<typeof sendMessage>) => sendMessage(...args),
	};
}

test("a tool result's details.view is its item's view, live, read back and after a reload from disk", async () => {
	const { server, a, thread, call, completed, readBack } = await viewServer({ view: table });
	await call("check");
	const live = await completed((item) => item.type === "toolCall" && item.tool === "check");
	expect(live.item).toMatchObject({ view: table, output: [{ type: "text", text: "RAW OUTPUT" }] });
	expect((await readBack()).find((item) => item.type === "toolCall")).toMatchObject({ view: table });
	await server.threads.unload(thread.id);
	await a.client.request("thread/resume", { threadId: thread.id });
	expect((await readBack()).find((item) => item.type === "toolCall")).toMatchObject({ view: table });
});

test("an extension message's details.view is its item's view, live and read back", async () => {
	const sent: { view: View } = { view: { type: "markdown", markdown: "**checked**" } };
	const { a, call, sendMessage, completed, readBack } = await viewServer({});
	// An idle extension message joins the last turn, so there has to be one.
	await call("check");
	sendMessage({ customType: "checks", content: "checked", display: true, details: sent });
	await a.waitFor("item/completed", (p) => (p.item as Item).type === "extensionMessage");
	expect((await completed((item) => item.type === "extensionMessage")).item).toMatchObject({
		extension: "checks",
		text: "checked",
		view: sent.view,
	});
	expect((await readBack()).find((item) => item.type === "extensionMessage")).toMatchObject({ view: sent.view });
});

test("an invalid details.view gives no view, the output stays, and nobody is warned", async () => {
	const { a, call, completed, readBack } = await viewServer({ view: { type: "script", src: "x" } });
	const mark = a.notifications.length;
	await call("check");
	const live = (await completed((item) => item.type === "toolCall")).item;
	expect(live).not.toHaveProperty("view");
	expect(live).toMatchObject({ output: [{ type: "text", text: "RAW OUTPUT" }] });
	expect((await readBack()).find((item) => item.type === "toolCall")).not.toHaveProperty("view");
	expect(warnings(a, mark)).toEqual([]);
});

test("a nested call's result view is on its live item", async () => {
	const { call, completed } = await viewServer({ view: table });
	await call("outer");
	const nested = (await completed((item) => item.type === "toolCall" && item.tool === "check")).item;
	expect(nested).toMatchObject({ view: table, parentItemId: expect.any(String) });
});

test("an item over the inline limit still travels as a reference that holds the view", async () => {
	const big: View = { type: "markdown", markdown: "v".repeat(60 * 1024) };
	const { call, completed } = await viewServer({ view: big }, "o".repeat(8 * 1024));
	await call("check");
	const { item, wire } = await completed((item) => item.type === "toolCall");
	expect(wire.type).toBe("itemReference");
	expect(item).toMatchObject({ view: big });
});

test("the desktop-view example: its widget, its button and its tool's view work end to end", async () => {
	const server = await startServer({ extraExtensions: [desktopView] });
	const a = await server.connect("desktop");
	const { thread, ui } = await a.client.request("thread/start", { cwd: server.cwd, approvalMode: "fullAccess" });
	const [widget] = ui.widgets;
	expect(widget).toMatchObject({ key: "desktop-view:checks", placement: "aboveEditor" });
	expect(JSON.stringify(widget)).toContain("Checks reset 0 times");
	await a.client.request("ui/event", { threadId: thread.id, widgetKey: "desktop-view:checks", id: "reset" });
	const pressed = await a.waitFor("ui/widget", (p) => JSON.stringify(p).includes("Checks reset 1 time"));
	expect(pressed.key).toBe("desktop-view:checks");
	await a.client.request("ui/event", {
		threadId: thread.id,
		widgetKey: "desktop-view:checks",
		id: "verbose",
		value: true,
	});
	await a.waitFor("ui/widget", (p) => JSON.stringify(p).includes('"value":true'));
	server.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("check_summary", {})], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await a.client.request("turn/start", { threadId: thread.id, text: "summarize" });
	await a.waitFor("turn/completed");
	const call = (await a.readTurns(thread.id)).flatMap((t) => t.items).find((i) => i.type === "toolCall");
	expect(call).toMatchObject({ tool: "check_summary", view: { type: "table", columns: ["check", "result"] } });
});
