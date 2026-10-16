import { expect, test, vi } from "vitest";

const fake = vi.hoisted(() => {
	Object.assign(globalThis, { window: { addEventListener: () => {} } });
	const requests: Array<{ method: string; params: unknown }> = [];
	let onHostEvent: (event: unknown) => void = () => {};
	const results: Record<string, (params: { threadId?: string }) => unknown> = {
		"thread/list": () => ({ threads: [] }),
		"model/list": () => ({ models: [], default: null }),
		"account/list": () => ({ accounts: [] }),
		"thread/resume": ({ threadId }) => ({
			thread: { id: threadId },
			turns: [],
			queue: [],
			usage: null,
			warnings: [],
		}),
	};
	const client = {
		request: (method: string, params: { threadId?: string }) => {
			requests.push({ method, params });
			return Promise.resolve(results[method]!(params));
		},
		host: () => Promise.resolve({ projects: [], preferences: {} }),
		onNotification: () => {},
		onServerRequest: () => {},
		onHostEvent: (handler: typeof onHostEvent) => (onHostEvent = handler),
	};
	return { client, requests, serverState: (state: string) => onHostEvent({ event: "server/state", state }) };
});

vi.mock("../../src/renderer/client.ts", () => ({ client: fake.client, RequestError: class extends Error {} }));

import { getState, openThread } from "../../src/renderer/store.ts";

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
