import type { EffectCallback } from "react";
import type { experimental_Operation } from "@knightcodeai/cli/desktop";
import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
	effects: [] as { effect: EffectCallback; deps: readonly unknown[] }[],
	updates: vi.fn(),
	admissionChanged: undefined as (() => void) | undefined,
}));
vi.mock("react", async (original) => ({
	...(await original<object>()),
	useEffect: (effect: EffectCallback, deps: readonly unknown[]) => hooks.effects.push({ effect, deps }),
	useState: () => [undefined, hooks.updates],
	useSyncExternalStore: (subscribe: (listener: () => void) => () => void, read: () => unknown) => {
		subscribe(() => hooks.admissionChanged?.());
		return read();
	},
}));
const fixture = vi.hoisted(() => ({
	thread: { id: "A", cwd: "/A", projectCwd: "/A" },
	request: vi.fn(),
	notify: vi.fn(),
	window: { addEventListener() {}, removeEventListener() {}, knightcode: { platform: "linux" } },
}));
vi.hoisted(() => Object.assign(globalThis, { window: fixture.window }));
vi.mock("../../src/renderer/client.ts", () => ({
	client: { request: fixture.request, host: vi.fn() },
	RequestError: class extends Error {
		code: string;
		data: unknown;
		constructor(code: string, message: string, data?: unknown) {
			super(message);
			this.code = code;
			this.data = data;
		}
	},
}));
vi.mock("../../src/renderer/store.ts", () => ({
	getState: () => ({ held: { A: { thread: fixture.thread } }, threads: [fixture.thread] }),
	toast: fixture.notify,
	openThread() {},
	refreshDiff() {},
	useStore: (read: (state: { server: { state: string }; diffVersion: Record<string, number> }) => unknown) =>
		read({ server: { state: "ready" }, diffVersion: {} }),
}));
import { RequestError } from "../../src/renderer/client.ts";
import { workspaceServices } from "../../src/renderer/extensions/workspace.ts";

const target = { threadId: "A", cwd: "/A", projectCwd: "/A" };

it("reissues Git reads whose replies arrive before activation readiness", async () => {
	let ready = false;
	let notify = () => {};
	const activation = new AbortController();
	const services = workspaceServices(
		activation.signal,
		() => ready,
		(listener) => {
			notify = listener;
			return () => {};
		},
	);
	fixture.request.mockResolvedValueOnce({ branch: "before-ready" }).mockResolvedValueOnce({ branch: "live" });
	const render = () => {
		hooks.effects.length = 0;
		services.experimental_useGit(target, { status: true });
		return hooks.effects[1]!;
	};
	const initial = render();
	const cleanup = initial.effect();
	await Promise.resolve();
	expect(hooks.updates).not.toHaveBeenCalled();
	let live: ReturnType<typeof render> | undefined;
	hooks.admissionChanged = () => {
		live = render();
	};
	ready = true;
	notify();
	expect(live?.deps).not.toEqual(initial.deps);
	if (typeof cleanup === "function") cleanup();
	const dispose = live?.effect();
	await Promise.resolve();
	expect(fixture.request.mock.calls).toEqual([
		["git/status", { threadId: "A" }],
		["git/status", { threadId: "A" }],
	]);
	const update = hooks.updates.mock.calls[0]?.[0] as (previous: undefined) => unknown;
	expect(update(undefined)).toMatchObject({ values: { status: { branch: "live" } } });
	if (typeof dispose === "function") dispose();
});
afterEach(() => {
	hooks.effects.length = 0;
	hooks.updates.mockReset();
	hooks.admissionChanged = undefined;
	fixture.request.mockReset();
	fixture.notify.mockReset();
	fixture.thread = { id: "A", cwd: "/A", projectCwd: "/A" };
});

describe("workspace controller admission", () => {
	it("keeps saved controllers on their checkout and refuses retired epochs before dispatch", async () => {
		const lifetime = new AbortController();
		const services = workspaceServices(lifetime.signal);
		const controller = services.experimental_git(target);
		const completed: experimental_Operation = {
			id: "completed",
			kind: "push",
			target,
			status: "completed",
			recovery: "none",
			completed: ["push"],
			outputs: {},
		};
		fixture.request.mockResolvedValue({ operation: completed });
		expect(await controller.experimental_run({ kind: "push" })).toEqual(completed);
		expect(fixture.request).toHaveBeenCalledWith("desktopOperation/start", { target, action: { kind: "push" } });
		fixture.thread = { id: "A", cwd: "/moved", projectCwd: "/A" };
		expect(await controller.experimental_run({ kind: "push" })).toBeUndefined();
		fixture.thread = { id: "A", cwd: "/A", projectCwd: "/A" };
		lifetime.abort();
		expect(await controller.experimental_run({ kind: "push" })).toBeUndefined();
		expect(await controller.experimental_recover("completed", "retry")).toBeUndefined();
		expect(fixture.request).toHaveBeenCalledTimes(1);
	});

	it("PR workflows keep intermediate commit/push outputs without adding new step toasts", async () => {
		fixture.thread = { id: "pr-toast", cwd: "/PR", projectCwd: "/PR" };
		const target = { threadId: "pr-toast", cwd: "/PR", projectCwd: "/PR" };
		const controller = workspaceServices(new AbortController().signal).experimental_git(target);
		const outputs = { commit: "sha1234", message: "change", remote: "origin", branch: "main" };
		fixture.request.mockResolvedValueOnce({
			operation: {
				id: "failed-pr",
				kind: "pullRequest",
				target,
				status: "partial",
				recovery: "retry",
				completed: ["commit", "push"],
				outputs,
			},
		});
		await controller.experimental_run({ kind: "pullRequest", commitFirst: true });
		expect(fixture.notify).not.toHaveBeenCalled();
		fixture.request.mockResolvedValueOnce({
			operation: {
				id: "completed-pr",
				kind: "pullRequest",
				target,
				status: "completed",
				recovery: "none",
				completed: ["commit", "push", "pr"],
				outputs: { ...outputs, url: "https://github.com/example/repo/pull/1" },
			},
		});
		await controller.experimental_run({ kind: "pullRequest", commitFirst: true });
		expect(fixture.notify.mock.calls).toEqual([["Created https://github.com/example/repo/pull/1", "success"]]);
	});

	it("retains the native journal's confirmed outputs when the transport fails", async () => {
		const services = workspaceServices(new AbortController().signal);
		const controller = services.experimental_git(target);
		const unknown: experimental_Operation = {
			id: "native-journal",
			target,
			kind: "pullRequest",
			status: "outcome-unknown",
			recovery: "reconcile",
			completed: ["push"],
			outputs: { remote: "origin", branch: "main" },
		};
		fixture.request.mockRejectedValue(new RequestError("serverRestarted", "closed", { operation: unknown }));
		expect(await controller.experimental_run({ kind: "pullRequest", commitFirst: false })).toEqual(unknown);
		expect(
			await services.experimental_git(target).experimental_run({ kind: "pullRequest", commitFirst: false }),
		).toEqual(unknown);
		expect(fixture.request).toHaveBeenCalledTimes(1);
		fixture.request.mockResolvedValue({ accepted: true });
		await controller.experimental_recover(unknown.id, "acknowledge");
		expect(fixture.request).toHaveBeenLastCalledWith("desktopOperation/recover", {
			target,
			id: unknown.id,
			action: "acknowledge",
		});
	});
});
