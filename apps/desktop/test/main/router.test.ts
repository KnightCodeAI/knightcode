import type { Message } from "@knightcode/app-server-protocol";
import { describe, expect, test } from "vitest";
import { Router, type WindowLink } from "../../src/main/router.ts";

function setup() {
	const toServer: Message[] = [];
	/** True while no child runs (restart backoff or failed). */
	const server = { down: false };
	const router = new Router({
		send: (m) => !server.down && (toServer.push(m), true),
		initializeResult: () => ({ serverInfo: { name: "knightcode", version: "1" } }),
	});
	const inbox = new Map<number, unknown[]>();
	const focus = { id: 0 };
	const open = (id: number, lastFocusedAt = 0): WindowLink => {
		inbox.set(id, []);
		const link: WindowLink = {
			id,
			send: (m) => inbox.get(id)!.push(m),
			isFocused: () => focus.id === id,
			lastFocusedAt: () => lastFocusedAt,
		};
		router.attach(link);
		return link;
	};
	/** Forward a window request and answer it from the server with `result`. */
	const roundTrip = (windowId: number, id: number, method: string, params: object, result: unknown) => {
		router.fromWindow(windowId, { id, method, params } as Message);
		const sent = toServer.at(-1) as { id: string };
		router.fromServer({ id: sent.id, result } as Message);
	};
	return { router, toServer, inbox, open, focus, roundTrip, server };
}

const thread = (id: string) => ({ thread: { id } });

describe("router", () => {
	test("a final unknown reply is retained after its renderer detaches", () => {
		const { router, toServer, open, inbox, roundTrip } = setup();
		open(1);
		const target = { threadId: "t", cwd: "/repo", projectCwd: "/repo" };
		router.fromWindow(1, {
			id: 1,
			method: "desktopOperation/start",
			params: { target, action: { kind: "push" } },
		} as Message);
		const sent = toServer.at(-1) as { id: string };
		router.detach(1);
		router.fromServer({
			id: sent.id,
			result: {
				operation: {
					id: "op",
					kind: "push",
					target,
					status: "outcome-unknown",
					recovery: "reconcile",
					completed: ["commit"],
					outputs: { commit: "confirmed" },
				},
			},
		} as Message);
		router.serverRestarted();
		open(2);
		roundTrip(2, 2, "desktopOperation/read", { threadId: "t" }, { operations: [] });
		expect(inbox.get(2)?.at(-1)).toMatchObject({
			result: { operations: [{ id: "op", status: "outcome-unknown", outputs: { commit: "confirmed" } }] },
		});
	});

	test("desktop native approval and epoch traffic cannot bypass the main-owned host boundary", () => {
		const { router, toServer, inbox, open } = setup();
		open(1);
		router.fromWindow(1, {
			id: 1,
			method: "desktopExtension/set",
			params: { owner: "example", approve: true, kinds: ["backend"] },
		} as Message);
		expect(toServer).toEqual([]);
		expect(inbox.get(1)).toEqual([
			{ id: 1, error: { code: "invalidParams", message: "Use the mediated desktop extension host." } },
		]);
	});

	test("a lost Git write retains confirmed outputs across renderer reload and cannot replay", () => {
		const { router, toServer, inbox, open, roundTrip } = setup();
		open(1);
		const target = { threadId: "t", cwd: "/repo", projectCwd: "/repo" };
		router.fromWindow(1, {
			id: 1,
			method: "desktopOperation/start",
			params: {
				target,
				action: { kind: "pullRequest", commitFirst: false },
			},
		} as Message);
		const running = {
			id: "op",
			kind: "pullRequest",
			target,
			status: "running",
			stage: "pr",
			completed: ["push"],
			recovery: "none",
			outputs: { branch: "main", remote: "origin" },
		};
		router.fromServer({
			method: "desktopOperation/changed",
			params: { threadId: "t", operations: [running] },
		} as Message);
		router.detach(1);
		router.serverRestarted();
		open(1);
		roundTrip(1, 2, "desktopOperation/read", { threadId: "t" }, { operations: [] });
		expect(inbox.get(1)?.at(-1)).toMatchObject({
			id: 2,
			result: {
				operations: [{ id: "op", status: "outcome-unknown", recovery: "reconcile", outputs: { remote: "origin" } }],
			},
		});
		const count = toServer.length;
		router.fromWindow(1, {
			id: 3,
			method: "desktopOperation/start",
			params: { target, action: { kind: "pullRequest", commitFirst: false } },
		} as Message);
		expect(toServer).toHaveLength(count);
		expect(inbox.get(1)?.at(-1)).toMatchObject({
			id: 3,
			result: { operation: { id: "op", status: "outcome-unknown" } },
		});
		router.fromWindow(1, {
			id: 4,
			method: "desktopOperation/recover",
			params: { target, id: "op", action: "acknowledge" },
		} as Message);
		expect(inbox.get(1)).toContainEqual({ id: 4, result: { accepted: true } });
	});

	test.skipIf(process.platform !== "win32")(
		"native recovery matches the canonical Windows project key without duplicating the pending write",
		() => {
			const { router, open, inbox, roundTrip } = setup();
			open(1);
			const target = { threadId: "t", cwd: "C:\\Repo", projectCwd: "C:\\Repo" };
			router.fromWindow(1, {
				id: 1,
				method: "desktopOperation/start",
				params: { target, action: { kind: "push" } },
			} as Message);
			router.fromServer({
				method: "desktopOperation/changed",
				params: {
					threadId: "t",
					operations: [
						{
							id: "canonical",
							kind: "push",
							target: { ...target, projectCwd: "c:\\repo" },
							status: "running",
							stage: "push",
							completed: [],
							outputs: {},
							recovery: "none",
						},
					],
				},
			} as Message);
			router.serverRestarted();
			roundTrip(1, 2, "desktopOperation/read", { threadId: "t" }, { operations: [] });
			expect(inbox.get(1)?.at(-1)).toMatchObject({ result: { operations: [{ id: "canonical" }] } });
			expect((inbox.get(1)?.at(-1) as { result: { operations: unknown[] } }).result.operations).toHaveLength(1);
			router.fromWindow(1, {
				id: 3,
				method: "desktopOperation/recover",
				params: { target, id: "canonical", action: "acknowledge" },
			} as Message);
			expect(inbox.get(1)).toContainEqual({ id: 3, result: { accepted: true } });
		},
	);

	test.skipIf(process.platform !== "win32")(
		"a lost request finds its journaled write when the checkout path differs only in case",
		() => {
			const { router, open, inbox } = setup();
			open(1);
			const journaled = { threadId: "t", cwd: "c:\\repo", projectCwd: "c:\\repo" };
			router.fromServer({
				method: "desktopOperation/changed",
				params: {
					threadId: "t",
					operations: [
						{
							id: "op",
							kind: "push",
							target: journaled,
							status: "running",
							stage: "push",
							completed: [],
							outputs: {},
							recovery: "none",
						},
					],
				},
			} as Message);
			router.fromWindow(1, { id: 1, method: "desktopOperation/read", params: { threadId: "t" } } as Message);
			router.fromWindow(1, {
				id: 2,
				method: "desktopOperation/recover",
				params: {
					target: { threadId: "t", cwd: "C:\\Repo", projectCwd: "C:\\Repo" },
					id: "other",
					action: "retry",
				},
			} as Message);
			router.serverRestarted();
			expect(inbox.get(1)).toContainEqual({
				id: 2,
				error: expect.objectContaining({
					code: "serverRestarted",
					data: { operation: expect.objectContaining({ id: "op", status: "outcome-unknown" }) },
				}),
			});
		},
	);

	test("malformed workspace wire params cannot corrupt the restart journal", () => {
		const { router, toServer, open, inbox } = setup();
		open(1);
		router.fromWindow(1, { id: 11, method: "desktopOperation/start", params: {} } as Message);
		expect(() => router.serverRestarted()).not.toThrow();
		expect(toServer).toHaveLength(0);
		expect(inbox.get(1)).toEqual([
			{ id: 11, error: { code: "invalidParams", message: "Invalid desktop operation parameters." } },
		]);
	});

	test("the same client id from two windows reaches the server distinct and returns to its sender", () => {
		const { router, toServer, inbox, open } = setup();
		open(1);
		open(2);
		router.fromWindow(1, { id: 7, method: "model/list", params: {} } as Message);
		router.fromWindow(2, { id: 7, method: "model/list", params: {} } as Message);
		const ids = toServer.map((m) => (m as { id: string }).id);
		expect(new Set(ids).size).toBe(2);
		router.fromServer({ id: ids[1]!, result: { from: "second" } } as Message);
		router.fromServer({ id: ids[0]!, result: { from: "first" } } as Message);
		expect(inbox.get(1)).toEqual([{ id: 7, result: { from: "first" } }]);
		expect(inbox.get(2)).toEqual([{ id: 7, result: { from: "second" } }]);
	});

	test("initialize is answered from main's cached result without a server round trip", () => {
		const { router, toServer, inbox, open } = setup();
		open(1);
		router.fromWindow(1, { id: 1, method: "initialize", params: {} } as Message);
		expect(toServer).toEqual([]);
		expect(inbox.get(1)).toEqual([{ id: 1, result: { serverInfo: { name: "knightcode", version: "1" } } }]);
	});

	test("a request sent while no app server runs fails at once instead of waiting forever", () => {
		const { router, toServer, inbox, open, server } = setup();
		open(1);
		router.serverRestarted();
		server.down = true;
		router.fromWindow(1, { id: 3, method: "thread/resume", params: { threadId: "t1" } } as Message);
		expect(toServer).toEqual([]);
		expect(inbox.get(1)).toEqual([{ id: 3, error: { code: "serverRestarted", message: "KnightCode is not running" } }]);
		// Not left pending: the next restart has nothing to fail twice.
		router.serverRestarted();
		expect(inbox.get(1)).toHaveLength(1);
	});

	test("thread notifications go to holders only; sidebar notifications to every window", () => {
		const { router, inbox, open, roundTrip } = setup();
		open(1);
		open(2);
		roundTrip(1, 1, "thread/resume", { threadId: "t" }, thread("t"));
		router.fromServer({
			method: "item/agentMessage/delta",
			params: { threadId: "t", turnId: "u", itemId: "i", delta: "x" },
		} as Message);
		router.fromServer({
			method: "thread/status/changed",
			params: { threadId: "t", status: { type: "idle" } },
		} as Message);
		expect(inbox.get(1)!.filter((m) => (m as { method?: string }).method)).toHaveLength(2);
		expect(inbox.get(2)).toEqual([
			{ method: "thread/status/changed", params: { threadId: "t", status: { type: "idle" } } },
		]);
	});

	test("releasing one of two holders answers locally; the last release unsubscribes the server once", () => {
		const { router, toServer, inbox, open, roundTrip } = setup();
		open(1);
		open(2);
		roundTrip(1, 1, "thread/resume", { threadId: "t" }, thread("t"));
		roundTrip(2, 1, "thread/resume", { threadId: "t" }, thread("t"));
		const before = toServer.length;
		router.fromWindow(1, { id: 2, method: "thread/unsubscribe", params: { threadId: "t" } } as Message);
		expect(toServer.length).toBe(before);
		expect(inbox.get(1)!.at(-1)).toEqual({ id: 2, result: { status: "unsubscribed" } });
		router.fromWindow(2, { id: 2, method: "thread/unsubscribe", params: { threadId: "t" } } as Message);
		expect(toServer.slice(before).map((m) => (m as { method: string }).method)).toEqual(["thread/unsubscribe"]);
	});

	test("an unsubscribe from a window that does not hold the thread is answered locally", () => {
		const { router, toServer, inbox, open, roundTrip } = setup();
		open(1);
		open(2);
		roundTrip(1, 1, "thread/resume", { threadId: "t" }, thread("t"));
		const before = toServer.length;
		router.fromWindow(2, { id: 3, method: "thread/unsubscribe", params: { threadId: "t" } } as Message);
		expect(toServer.length).toBe(before);
		expect(inbox.get(2)!.at(-1)).toEqual({ id: 3, result: { status: "notSubscribed" } });
		expect(router.heldThreads(1)).toEqual(["t"]);
	});

	test("a holding response that arrives after its window reloaded unsubscribes the server", () => {
		const { router, toServer, inbox, open } = setup();
		open(1);
		router.fromWindow(1, { id: 1, method: "thread/resume", params: { threadId: "t" } } as Message);
		const sent = toServer.at(-1) as { id: string };
		// A reload detaches and reattaches the same window id.
		router.detach(1);
		open(1);
		router.fromServer({ id: sent.id, result: thread("t") } as Message);
		expect(router.heldThreads()).toEqual([]);
		expect(inbox.get(1)).toEqual([]);
		expect(toServer.at(-1)).toMatchObject({ method: "thread/unsubscribe", params: { threadId: "t" } });
	});

	test("an approval goes to the last turn/start sender; closing it moves the request to the other holder", () => {
		const { router, toServer, inbox, open, roundTrip } = setup();
		open(1);
		open(2);
		roundTrip(1, 1, "thread/resume", { threadId: "t" }, thread("t"));
		roundTrip(2, 1, "turn/start", { threadId: "t", text: "go" }, { status: "started", threadId: "t", requestId: "r" });
		const approval = {
			id: 42,
			method: "item/toolCall/requestApproval",
			params: { threadId: "t", turnId: "u", itemId: "i", tool: "bash", input: {}, decisions: ["accept"] },
		};
		router.fromServer(approval as Message);
		expect(inbox.get(2)!.at(-1)).toEqual(approval);
		expect(inbox.get(1)!.some((m) => (m as { id?: number }).id === 42)).toBe(false);
		router.detach(2);
		expect(inbox.get(1)!.at(-1)).toEqual(approval);
		// Only the window that now holds the request may answer it.
		router.fromWindow(2, { id: 42, result: { decision: "accept" } } as Message);
		expect(toServer.some((m) => (m as { id?: unknown }).id === 42)).toBe(false);
		router.fromWindow(1, { id: 42, result: { decision: "accept" } } as Message);
		expect(toServer.at(-1)).toEqual({ id: 42, result: { decision: "accept" } });
	});

	test("unsubscribing the window an approval went to cancels it there and moves it on", () => {
		const { router, inbox, open, roundTrip } = setup();
		open(1);
		open(2, 5);
		roundTrip(1, 1, "turn/start", { threadId: "t", text: "go" }, { status: "started", threadId: "t", requestId: "r" });
		roundTrip(2, 1, "thread/resume", { threadId: "t" }, thread("t"));
		router.fromServer({
			id: "s1",
			method: "item/toolCall/requestApproval",
			params: { threadId: "t", turnId: "u", itemId: "i", tool: "bash", input: {}, decisions: [] },
		} as Message);
		router.fromWindow(1, { id: 9, method: "thread/unsubscribe", params: { threadId: "t" } } as Message);
		expect(inbox.get(1)).toContainEqual({ method: "serverRequest/cancelled", params: { id: "s1" } });
		expect(inbox.get(2)!.at(-1)).toMatchObject({ id: "s1", method: "item/toolCall/requestApproval" });
	});

	test("thread/replaced moves holds to the new id", () => {
		const { router, inbox, open, roundTrip } = setup();
		open(1);
		open(2);
		roundTrip(1, 1, "thread/resume", { threadId: "old" }, thread("old"));
		router.fromServer({ method: "thread/replaced", params: { oldThreadId: "old", thread: { id: "new" } } } as Message);
		router.fromServer({
			method: "turn/retry",
			params: { threadId: "new", turnId: "u", attempt: 1, maxAttempts: 3, delayMs: 1, error: "e" },
		} as Message);
		expect(inbox.get(1)!.map((m) => (m as { method?: string }).method)).toEqual([
			undefined,
			"thread/replaced",
			"turn/retry",
		]);
		expect(inbox.get(2)).toEqual([]);
		expect(router.heldThreads(1)).toEqual(["new"]);
	});

	test("the quit question counts threads whose last status is active, in any window or none", () => {
		const { router, open } = setup();
		open(1);
		const status = (threadId: string, type: string) =>
			router.fromServer({ method: "thread/status/changed", params: { threadId, status: { type } } } as Message);
		status("a", "active");
		status("b", "active");
		status("a", "idle");
		expect(router.activeThreads()).toBe(1);
		// A restart interrupts every turn; nothing is left to ask about.
		router.serverRestarted();
		expect(router.activeThreads()).toBe(0);
	});

	test("a server exit fails forwarded requests and cancels open server requests", () => {
		const { router, inbox, open, roundTrip } = setup();
		open(1);
		roundTrip(1, 1, "thread/resume", { threadId: "t" }, thread("t"));
		router.fromServer({
			id: "s1",
			method: "item/toolCall/requestApproval",
			params: { threadId: "t", turnId: "u", itemId: "i", tool: "bash", input: {}, decisions: [] },
		} as Message);
		router.fromWindow(1, { id: 5, method: "model/list", params: {} } as Message);
		router.serverRestarted();
		expect(inbox.get(1)).toContainEqual({
			id: 5,
			error: { code: "serverRestarted", message: "KnightCode restarted before answering" },
		});
		expect(inbox.get(1)).toContainEqual({ method: "serverRequest/cancelled", params: { id: "s1" } });
		// Holds survive the restart; the window resumes what it shows.
		expect(router.heldThreads(1)).toEqual(["t"]);
	});
});
