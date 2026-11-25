import { afterEach, describe, expect, it, vi } from "vitest";
import { handoffPreflight, handoffProblem } from "../../src/renderer/extensions/handoff-preflight.ts";

afterEach(() => vi.useRealTimers());

describe("handoff preflight", () => {
	it("debounces edits, drops an obsolete answer and rechecks on focus", async () => {
		vi.useFakeTimers();
		let release!: (value: { status: "ready"; branch: string }) => void;
		const first = new Promise<{ status: "ready"; branch: string }>((resolve) => {
			release = resolve;
		});
		const read = vi.fn((branch: string) =>
			branch === "a" ? first : Promise.resolve({ status: "ready" as const, branch }),
		);
		const publish = vi.fn();
		const check = handoffPreflight(read, publish);
		check.set("a");
		await vi.advanceTimersByTimeAsync(249);
		expect(read).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		check.set("b");
		await vi.advanceTimersByTimeAsync(250);
		release({ status: "ready", branch: "a" });
		await vi.advanceTimersByTimeAsync(0);
		expect(publish).toHaveBeenLastCalledWith("b", { status: "ready", branch: "b" });
		check.refresh();
		expect(publish).toHaveBeenLastCalledWith("b", { status: "checking" });
		await vi.advanceTimersByTimeAsync(250);
		expect(read.mock.calls).toEqual([["a"], ["b"], ["b"]]);
		check.stop();
	});

	it("keeps a failed transport distinct from structured server refusal", () => {
		expect(handoffProblem({ code: "internal", message: "connection closed" }).status).toBe("transport-error");
		expect(handoffProblem({ code: "gitConflict", message: "dirty", paths: ["a.txt"] })).toEqual({
			status: "refused",
			problem: { code: "gitConflict", message: "dirty", paths: ["a.txt"] },
		});
	});
});
