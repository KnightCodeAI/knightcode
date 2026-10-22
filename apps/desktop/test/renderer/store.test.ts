import { expect, test, vi } from "vitest";

const fake = vi.hoisted(() => {
	Object.assign(globalThis, { window: { addEventListener: () => {} } });
	const requests: Array<{ method: string; params: unknown }> = [];
	let onHostEvent: (event: unknown) => void = () => {};
	let onNotification: (n: unknown) => void = () => {};
	const results: Record<string, (params: { threadId?: string }) => unknown> = {
		"thread/list": () => ({ threads: [] }),
		"model/list": () => ({ models: [], default: null }),
		"account/list": () => ({ accounts: [] }),
		"config/read": () => ({ settings: {} }),
		"thread/resume": ({ threadId }) => ({
			thread: { id: threadId },
			turns: [],
			queue: [],
			usage: null,
			warnings: [],
			ui: { statuses: [], workingVisible: true, widgets: [] },
		}),
	};
	const client = {
		request: (method: string, params: { threadId?: string }) => {
			requests.push({ method, params });
			return Promise.resolve(results[method]!(params));
		},
		host: () => Promise.resolve({ projects: [], preferences: {}, sidebar: { width: 276, collapsed: false } }),
		onNotification: (handler: typeof onNotification) => (onNotification = handler),
		onServerRequest: () => {},
		onHostEvent: (handler: typeof onHostEvent) => (onHostEvent = handler),
	};
	return {
		client,
		requests,
		results,
		serverState: (state: string) => onHostEvent({ event: "server/state", state }),
		notify: (method: string, params: unknown) => onNotification({ method, params }),
	};
});

vi.mock("../../src/renderer/client.ts", () => ({ client: fake.client, RequestError: class extends Error {} }));

import type { UiSnapshot } from "@knightcode/app-server-protocol";
import { deleteThread, getState, openThread, refreshThreads, startThread } from "../../src/renderer/store.ts";

const resumed = () => fake.requests.filter((r) => r.method === "thread/resume").map((r) => r.params);

test("after an app server restart the window resumes every thread it held", async () => {
	fake.serverState("ready");
	await openThread("t1");
	await openThread("t2");
	expect(Object.keys(getState().held)).toEqual(["t1", "t2"]);
	fake.requests.length = 0;

	fake.serverState("restarting");
	expect(resumed()).toEqual([]);
	fake.serverState("ready");
	await vi.waitFor(() => expect(resumed()).toEqual([{ threadId: "t1" }, { threadId: "t2" }]));
});

test("after a restart a thread whose resume fails keeps no extension UI from the old server", async () => {
	const widget = { key: "w", placement: "aboveEditor" as const, lines: ["old"] };
	fake.serverState("ready");
	await openThread("t3");
	fake.notify("ui/widget", { threadId: "t3", ...widget });
	fake.notify("ui/state", { threadId: "t3", statuses: [{ key: "s", text: "old" }], title: "Old", workingVisible: true });
	await vi.waitFor(() => expect(getState().held.t3?.ui.widgets).toEqual([widget]));
	const saved = fake.results["thread/resume"]!;
	try {
		// The killed server's lock is still live, so the new server cannot open the thread yet.
		fake.results["thread/resume"] = () => {
			throw Object.assign(new Error("locked"), { code: "threadLockedElsewhere" });
		};
		fake.serverState("restarting");
		fake.serverState("ready");
		await vi.waitFor(() => expect(getState().opening.t3).toBeDefined());
		expect(getState().held.t3?.ui).toEqual({ statuses: [], workingVisible: true, widgets: [] });
	} finally {
		fake.results["thread/resume"] = saved;
	}
});

test("deleting a thread still in the sidebar archives it first, as the server deletes only archived threads", async () => {
	const saved = { ...fake.results };
	try {
		fake.results["thread/list"] = () => ({ threads: [{ id: "live", status: { type: "idle" } }] });
		fake.results["thread/archive"] = () => ({});
		fake.results["thread/delete"] = () => ({});
		await refreshThreads();
		// One from Settings › Archived is no longer in the sidebar's list.
		expect(getState().threads.map((t) => t.id)).toEqual(["live"]);
		fake.requests.length = 0;
		await deleteThread("live");
		await deleteThread("archived");
		expect(fake.requests.map((r) => `${r.method} ${(r.params as { threadId: string }).threadId}`)).toEqual([
			"thread/archive live",
			"thread/delete live",
			"thread/delete archived",
		]);
	} finally {
		for (const key of Object.keys(fake.results)) if (!(key in saved)) delete fake.results[key];
		Object.assign(fake.results, saved);
		await refreshThreads();
	}
});

const ui = (widgets: UiSnapshot["widgets"] = [], title?: string): UiSnapshot => ({
	statuses: [{ key: "tests", text: "ok" }],
	...(title ? { title } : {}),
	workingVisible: true,
	widgets,
});
const lines = (key: string, text: string) => ({ key, placement: "aboveEditor" as const, lines: [text] });
const resumeWith = (snapshot: UiSnapshot, turns: unknown[] = []) => {
	fake.results["thread/resume"] = ({ threadId }) => ({
		thread: { id: threadId, workspace: { mode: "local" } },
		turns,
		queue: { steering: [], followUp: [] },
		usage: null,
		warnings: [],
		ui: snapshot,
	});
};
const uiOf = (id: string) => getState().held[id]?.ui;

test("a resume installs ui, and ui/state and ui/widget keep it current", async () => {
	fake.serverState("ready");
	resumeWith(ui([lines("a", "one")], "watching"));
	await openThread("u1");
	expect(uiOf("u1")).toEqual(ui([lines("a", "one")], "watching"));

	fake.notify("ui/state", { threadId: "u1", statuses: [], workingMessage: "Running", workingVisible: false });
	await vi.waitFor(() =>
		expect(uiOf("u1")).toEqual({
			statuses: [],
			workingMessage: "Running",
			workingVisible: false,
			widgets: [lines("a", "one")],
		}),
	);
	fake.notify("ui/widget", { threadId: "u1", ...lines("b", "two") });
	fake.notify("ui/widget", { threadId: "u1", ...lines("a", "uno") });
	await vi.waitFor(() => expect(uiOf("u1")?.widgets).toEqual([lines("b", "two"), lines("a", "uno")]));
	fake.notify("ui/widget", { threadId: "u1", key: "b" });
	await vi.waitFor(() => expect(uiOf("u1")?.widgets).toEqual([lines("a", "uno")]));
});

test("a ui/widget arriving while a resume installs applies after its snapshot", async () => {
	fake.serverState("ready");
	const turn = { id: "m1", threadId: "u2", status: "completed", startedAt: 1, items: [] };
	const bytes = new TextEncoder().encode(JSON.stringify(turn));
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	let asked!: () => void;
	const reading = new Promise<void>((resolve) => (asked = resolve));
	fake.results["payload/read"] = () => {
		asked();
		return released.then(() => ({ data: btoa(String.fromCharCode(...bytes)), eof: true }));
	};
	resumeWith(ui([lines("a", "snapshot")]), [
		{ id: "m1", threadId: "u2", status: "completed", startedAt: 1, payload: { id: "p1", byteLength: bytes.length } },
	]);
	const opening = openThread("u2");
	await reading;
	// Newer than the snapshot: it must land on top of it, not under it.
	fake.notify("ui/widget", { threadId: "u2", ...lines("b", "live") });
	release();
	await opening;
	await vi.waitFor(() => expect(uiOf("u2")?.widgets).toEqual([lines("a", "snapshot"), lines("b", "live")]));
});

test("a started thread installs its result's ui; a replaced one takes the new thread's", async () => {
	fake.serverState("ready");
	fake.results["thread/start"] = () => ({
		thread: { id: "s1", workspace: { mode: "local" } },
		warnings: [],
		ui: ui([lines("a", "from start")]),
	});
	fake.results["turn/start"] = () => ({ status: "started", threadId: "s1", requestId: "r1" });
	await startThread("/p", "hi", {});
	expect(uiOf("s1")).toEqual(ui([lines("a", "from start")]));

	resumeWith(ui([lines("a", "replacement")]));
	fake.notify("thread/replaced", {
		oldThreadId: "s1",
		thread: { id: "s2", name: "", updatedAt: "", workspace: { mode: "local" } },
	});
	await vi.waitFor(() => expect(uiOf("s2")).toEqual(ui([lines("a", "replacement")])));
	expect(getState().held.s1).toBeUndefined();
});
