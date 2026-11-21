/** Revision switches never send an old window handle to an incompatible backend. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DesktopRevisionCoordinator,
	type DesktopBackendActivation,
	type DesktopWindowParticipant,
} from "../src/app-server/desktop-extensions/coordinator.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function participant(id: string, trace: string[]): DesktopWindowParticipant {
	return {
		id,
		signal: new AbortController().signal,
		prepare: async (binding) => {
			trace.push(`${id}:prepare:${binding.revision}`);
		},
		quiesce: async () => {
			trace.push(`${id}:quiesce`);
		},
		publish: async (binding) => {
			trace.push(`${id}:publish:${binding.revision}`);
		},
		resume: async (binding) => {
			trace.push(`${id}:resume:${binding.revision}`);
		},
		discard: async () => {
			trace.push(`${id}:discard`);
		},
		revoke: () => {
			trace.push(`${id}:revoke`);
		},
	};
}
function backend(revision: string, trace: string[]): DesktopBackendActivation {
	return {
		call: async (method, params) => ({ revision, method, params }),
		pause: async () => {
			trace.push(`${revision}:pause`);
		},
		resume: async () => {
			trace.push(`${revision}:resume`);
		},
		activate: async () => {
			trace.push(`${revision}:activate`);
		},
		dispose: async () => {
			trace.push(`${revision}:dispose`);
		},
	};
}
async function fixture() {
	const trace: string[] = [];
	const coordinator = new DesktopRevisionCoordinator("example", { readinessMs: 100, drainMs: 20 });
	const a = participant("a", trace);
	const b = participant("b", trace);
	await coordinator.join(a);
	await coordinator.join(b);
	const old = backend("v1", trace);
	expect((await coordinator.update("v1", async () => old)).status).toBe("committed");
	const binding = coordinator.binding("a")!;
	trace.length = 0;
	return { trace, coordinator, a, b, old, binding };
}
afterEach(() => {
	vi.useRealTimers();
});

describe("coordinated desktop revisions", () => {
	it("rejects reordered host request sequences without retaining every completed request ID", async () => {
		const { coordinator, binding, old } = await fixture();
		let writes = 0;
		old.call = async () => ++writes;
		expect(await coordinator.call(binding, 1, "write", "increment", {})).toMatchObject({ status: "ok" });
		expect(await coordinator.call(binding, 3, "write", "increment", {})).toMatchObject({ status: "ok" });
		expect(await coordinator.call(binding, 2, "write", "increment", {})).toEqual({ status: "disconnected" });
		expect(writes).toBe(2);
	});

	it("settles a cancelled write as unknown but still counts its real completion for draining", async () => {
		const { coordinator, binding, old, trace } = await fixture();
		const write = deferred<unknown>();
		old.call = () => write.promise;
		const pending = coordinator.call(binding, 1, "write", "increment", {});
		coordinator.cancel(binding, 1);
		expect(await pending).toEqual({ status: "outcome-unknown" });
		expect(await coordinator.update("v2", async () => backend("v2", trace))).toMatchObject({
			status: "retained",
			reason: "drain-timeout",
		});
		expect(trace).not.toContain("v1:dispose");
		write.resolve("completed");
		await Promise.resolve();
		await Promise.resolve();
	});

	it("revokes immediately and disposes even when a write cannot drain", async () => {
		const { coordinator, binding, old, trace } = await fixture();
		const work = deferred<unknown>();
		old.call = () => work.promise;
		const pending = coordinator.call(binding, 1, "write", "increment", {});
		const stopping = coordinator.shutdown();
		expect(coordinator.binding("a")).toBeUndefined();
		expect(await pending).toEqual({ status: "outcome-unknown" });
		expect(await stopping).toEqual({ status: "disabled", reason: "restart-required" });
		expect(trace).toContain("v1:dispose");
		work.resolve("completed");
	});

	it("can retire a backend when forced disposal settles the outstanding write", async () => {
		const { coordinator, binding, old } = await fixture();
		const work = deferred<unknown>();
		old.call = () => work.promise;
		old.dispose = async () => work.resolve("disposed");
		const pending = coordinator.call(binding, 1, "write", "increment", {});
		expect(await coordinator.shutdown()).toEqual({ status: "retired" });
		expect(await pending).toEqual({ status: "outcome-unknown" });
	});

	it.each(["pause", "dispose"] as const)("keeps restart-required when %s times out", async (method) => {
		const { coordinator, old } = await fixture();
		const dispose = vi.spyOn(old, "dispose");
		vi.spyOn(old, method).mockReturnValue(deferred<void>().promise);
		expect(await coordinator.shutdown()).toEqual({ status: "disabled", reason: "restart-required" });
		expect(dispose).toHaveBeenCalled();
	});

	it("rejects owner/revision/epoch/window mismatches before invoking a handler", async () => {
		const { coordinator, binding } = await fixture();
		for (const mismatch of [
			{ owner: "other" },
			{ revision: "v2" },
			{ epoch: "stale" },
			{ window: "b" },
			{ mount: "stale" },
		]) {
			expect(await coordinator.call({ ...binding, ...mismatch }, 1, "read", "value", {})).toEqual({
				status: "disconnected",
			});
		}
		expect(await coordinator.call(binding, 1, "read", "value", {})).toMatchObject({
			status: "ok",
			value: { revision: "v1" },
		});
	});

	it("serializes a joining window with the next revision decision", async () => {
		const { coordinator, trace } = await fixture();
		const started = deferred<void>();
		const ready = deferred<void>();
		const c = participant("c", trace);
		c.prepare = async () => {
			started.resolve();
			await ready.promise;
		};
		const joining = coordinator.join(c);
		await started.promise;
		const update = coordinator.update("v2", async () => backend("v2", trace));
		await Promise.resolve();
		await Promise.resolve();
		const preparedDuringJoin = trace.includes("a:prepare:v2");
		ready.resolve();
		await joining;
		await update;
		expect(preparedDuringJoin).toBe(false);
		expect(coordinator.binding("c")?.revision).toBe("v2");
	});

	it("does not attach a window whose host lifetime ended while waiting for a transaction", async () => {
		const { coordinator, trace } = await fixture();
		const blocked = deferred<DesktopBackendActivation>();
		const started = deferred<void>();
		const update = coordinator.update("v2", async () => {
			started.resolve();
			return blocked.promise;
		});
		await started.promise;
		const host = new AbortController();
		const c = { ...participant("c", trace), signal: host.signal };
		const joining = coordinator.join(c);
		host.abort();
		blocked.resolve(backend("v2", trace));
		await update;
		await joining;
		expect(coordinator.binding("c")).toBeUndefined();
		expect(trace).not.toContain("c:prepare:v2");
	});

	it("an aborted old host lifetime cannot revoke a replacement mount", async () => {
		const { coordinator, trace } = await fixture();
		const oldHost = new AbortController();
		await coordinator.join({ ...participant("a", trace), signal: oldHost.signal });
		await coordinator.join(participant("a", trace));
		const current = coordinator.binding("a");
		oldHost.abort();
		expect(coordinator.binding("a")).toEqual(current);
		expect(current).toBeDefined();
	});

	it("keeps v1 calls live while v2 preparation is still inert", async () => {
		const { coordinator, binding, trace } = await fixture();
		const ready = deferred<DesktopBackendActivation>();
		const started = deferred<void>();
		const update = coordinator.update("v2", async () => {
			started.resolve();
			return ready.promise;
		});
		await started.promise;
		expect(await coordinator.call(binding, 1, "read", "value", {})).toMatchObject({
			status: "ok",
			value: { revision: "v1" },
		});
		ready.resolve(backend("v2", trace));
		expect(await update).toMatchObject({ status: "committed" });
	});

	it("rejects reuse of an admitted request ID without replaying its write", async () => {
		const { coordinator, binding, old } = await fixture();
		let writes = 0;
		old.call = async () => ++writes;
		expect(await coordinator.call(binding, 2, "write", "increment", {})).toEqual({ status: "ok", value: 1 });
		expect(await coordinator.call(binding, 2, "write", "increment", {})).toEqual({ status: "disconnected" });
		expect(writes).toBe(1);
	});

	it("retains both old frontends and backend when any frontend prepare fails", async () => {
		const { coordinator, binding, b, trace } = await fixture();
		b.prepare = async () => {
			throw new Error("bad CSS");
		};
		expect(await coordinator.update("v2", async () => backend("v2", trace))).toMatchObject({ status: "retained" });
		expect(coordinator.binding("a")).toEqual(binding);
		expect(coordinator.binding("b")?.revision).toBe("v1");
		expect(trace).not.toContain("v1:dispose");
		expect(trace).not.toContain("v2:activate");
		expect(await coordinator.call(binding, 1, "read", "value", {})).toMatchObject({
			status: "ok",
			value: { revision: "v1" },
		});
	});

	it("aborts on drain timeout without disposing a backend executing a write", async () => {
		const { coordinator, binding, old, trace } = await fixture();
		const write = deferred<unknown>();
		old.call = () => write.promise;
		const pending = coordinator.call(binding, 2, "write", "increment", {});
		const update = await coordinator.update("v2", async () => backend("v2", trace));
		expect(update).toMatchObject({ status: "retained", reason: "drain-timeout" });
		expect(coordinator.binding("a")).toEqual(binding);
		expect(trace).not.toContain("v1:dispose");
		expect(trace).toContain("v1:resume");
		write.resolve("written");
		expect(await pending).toEqual({ status: "ok", value: "written" });
	});

	it("gates new admission, drains old calls, and activates the shared backend once", async () => {
		const { coordinator, binding, old, trace, a } = await fixture();
		const work = deferred<unknown>();
		old.call = () => work.promise;
		const pending = coordinator.call(binding, 1, "read", "value", {});
		const gated = deferred<void>();
		const current = coordinator.binding("a")!;
		a.quiesce = async () => {
			gated.resolve();
		};
		const switchPromise = coordinator.update("v2", async () => backend("v2", trace));
		await gated.promise;
		expect(await coordinator.call(current, 2, "read", "value", {})).toEqual({ status: "disconnected" });
		work.resolve("old response");
		expect(await pending).toEqual({ status: "ok", value: "old response" });
		expect(await switchPromise).toMatchObject({ status: "committed" });
		expect(trace.filter((line) => line === "v2:activate")).toHaveLength(1);
		expect(await coordinator.call(binding, 99, "read", "value", {})).toEqual({ status: "disconnected" });
		expect(await coordinator.call(coordinator.binding("a")!, 1, "read", "value", {})).toMatchObject({
			status: "ok",
			value: { revision: "v2" },
		});
	});

	it("revokes only the failed window after commit, never restores its v1 handle", async () => {
		const { coordinator, binding, b, trace } = await fixture();
		b.publish = async () => {
			throw new Error("render failed");
		};
		expect(await coordinator.update("v2", async () => backend("v2", trace))).toMatchObject({
			status: "committed",
			failedWindows: ["b"],
		});
		expect(coordinator.binding("b")).toBeUndefined();
		expect(coordinator.binding("a")?.revision).toBe("v2");
		expect(await coordinator.call(binding, 99, "write", "increment", {})).toEqual({ status: "disconnected" });
	});

	it("never resumes a failed window when its publication resolves after the deadline", async () => {
		const { coordinator, b, trace } = await fixture();
		const published = deferred<void>();
		b.publish = () => published.promise;
		expect(await coordinator.update("v2", async () => backend("v2", trace))).toMatchObject({
			status: "committed",
			failedWindows: ["b"],
		});
		published.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(trace).not.toContain("b:resume:v2");
		expect(coordinator.binding("b")).toBeUndefined();
	});

	it("does not resume old producers when preparation failed before quiescence", async () => {
		const { coordinator, trace } = await fixture();
		expect(
			await coordinator.update("v2", async () => {
				throw new Error("invalid schema");
			}),
		).toMatchObject({ status: "retained" });
		expect(trace).not.toContain("v1:resume");
	});

	it("disables all windows and refuses later activation after old shutdown fails", async () => {
		const { coordinator, old, trace } = await fixture();
		old.dispose = async () => {
			throw new Error("service still running");
		};
		expect(await coordinator.update("v2", async () => backend("v2", trace))).toMatchObject({ status: "disabled" });
		expect(coordinator.binding("a")).toBeUndefined();
		expect(coordinator.binding("b")).toBeUndefined();
		expect(trace).not.toContain("v2:activate");
		expect(await coordinator.update("v3", async () => backend("v3", trace))).toMatchObject({ status: "disabled" });
		expect(trace).not.toContain("v3:activate");
	});

	it("disables globally instead of throwing if restoring paused services fails", async () => {
		const { coordinator, old, trace } = await fixture();
		const work = deferred<unknown>();
		old.call = () => work.promise;
		old.resume = async () => {
			throw new Error("cannot resume");
		};
		const pending = coordinator.call(coordinator.binding("a")!, 2, "write", "increment", {});
		expect(await coordinator.update("v2", async () => backend("v2", trace))).toMatchObject({ status: "disabled" });
		expect(coordinator.binding("a")).toBeUndefined();
		expect(await pending).toEqual({ status: "outcome-unknown" });
		work.resolve("completed");
	});

	it("settles disconnected reads and ambiguous writes on loss without replay, requiring a new epoch", async () => {
		const { coordinator, binding, old, trace } = await fixture();
		const work = deferred<unknown>();
		let invocations = 0;
		old.call = () => {
			invocations++;
			return work.promise;
		};
		const read = coordinator.call(binding, 1, "read", "value", {});
		const write = coordinator.call(binding, 2, "write", "increment", {});
		coordinator.disconnect();
		expect(await read).toEqual({ status: "disconnected" });
		expect(await write).toEqual({ status: "outcome-unknown" });
		expect(coordinator.binding("a")).toBeUndefined();
		const restarted = new DesktopRevisionCoordinator("example");
		await restarted.join(participant("a", trace));
		await restarted.update("v1", async () => backend("v1", trace));
		expect(restarted.binding("a")?.epoch).not.toBe(binding.epoch);
		expect(await restarted.call(binding, 99, "write", "increment", {})).toEqual({ status: "disconnected" });
		work.resolve("late write completed");
		expect(invocations).toBe(2);
	});
});
