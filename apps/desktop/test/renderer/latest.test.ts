import { afterEach, expect, test, vi } from "vitest";
import { latestCheck, pollInOrder } from "../../src/renderer/latest.ts";

afterEach(() => {
	vi.useRealTimers();
});

/** A check whose answers the test releases by hand, in any order. */
function gated() {
	const pending = new Map<string, (refused: boolean) => void>();
	const asked: string[] = [];
	const check = (key: string) =>
		new Promise<boolean>((resolve) => {
			asked.push(key);
			pending.set(key, resolve);
		});
	return { check, asked, answer: (key: string, refused: boolean) => pending.get(key)!(refused) };
}

test("a branch edited to an existing one is refused after its check, and edited back is allowed again", async () => {
	vi.useFakeTimers();
	const gate = gated();
	const verdicts: [string, boolean][] = [];
	const checker = latestCheck(250, gate.check, (key, refused) => verdicts.push([key, refused]));
	checker.set("kc/new");
	await vi.advanceTimersByTimeAsync(250);
	gate.answer("kc/new", false);
	await vi.advanceTimersByTimeAsync(0);
	checker.set("main");
	await vi.advanceTimersByTimeAsync(250);
	gate.answer("main", true);
	await vi.advanceTimersByTimeAsync(0);
	checker.set("kc/new");
	await vi.advanceTimersByTimeAsync(250);
	gate.answer("kc/new", false);
	await vi.advanceTimersByTimeAsync(0);
	expect(verdicts).toEqual([
		["kc/new", false],
		["main", true],
		["kc/new", false],
	]);
});

test("keystrokes within the delay make one check; a slow check of an old name never overrides a newer one", async () => {
	vi.useFakeTimers();
	const gate = gated();
	const verdicts: [string, boolean][] = [];
	const checker = latestCheck(250, gate.check, (key, refused) => verdicts.push([key, refused]));
	checker.set("m");
	await vi.advanceTimersByTimeAsync(100);
	checker.set("ma");
	await vi.advanceTimersByTimeAsync(100);
	checker.set("main");
	await vi.advanceTimersByTimeAsync(250);
	expect(gate.asked).toEqual(["main"]);
	checker.set("main-2");
	await vi.advanceTimersByTimeAsync(250);
	// The newer answer first, then the old one late: only the newer counts.
	gate.answer("main-2", false);
	gate.answer("main", true);
	await vi.advanceTimersByTimeAsync(0);
	expect(verdicts).toEqual([["main-2", false]]);
	checker.stop();
	checker.set("x");
	checker.stop();
	await vi.advanceTimersByTimeAsync(500);
	expect(gate.asked).toEqual(["main", "main-2"]);
});

test("a refresh checks the same name again, and only its answer counts", async () => {
	vi.useFakeTimers();
	const asked: string[] = [];
	const answers: ((refused: boolean) => void)[] = [];
	const verdicts: [string, boolean][] = [];
	const checker = latestCheck(
		250,
		(key) =>
			new Promise<boolean>((resolve) => {
				asked.push(key);
				answers.push(resolve);
			}),
		(key, refused) => verdicts.push([key, refused]),
	);
	checker.set("main");
	await vi.advanceTimersByTimeAsync(250);
	checker.refresh();
	await vi.advanceTimersByTimeAsync(250);
	expect(asked).toEqual(["main", "main"]);
	// The refresh's answer (the changes were stashed meanwhile), then the first check's late refusal: dropped.
	answers[1]!(false);
	answers[0]!(true);
	await vi.advanceTimersByTimeAsync(0);
	expect(verdicts).toEqual([["main", false]]);
	checker.stop();
	checker.refresh();
	await vi.advanceTimersByTimeAsync(500);
	expect(asked).toHaveLength(2);
});

test("polling waits for each answer before the next read, so a slow answer never lands after a newer one", async () => {
	vi.useFakeTimers();
	const answers: ((output: string) => void)[] = [];
	const shown: string[] = [];
	let more = true;
	const stop = pollInOrder(
		1000,
		() => new Promise<string>((resolve) => answers.push(resolve)),
		(output) => {
			shown.push(output);
			return more;
		},
		() => shown.push("failed"),
	);
	await vi.advanceTimersByTimeAsync(0);
	expect(answers).toHaveLength(1);
	// A read slower than the interval starts no second one.
	await vi.advanceTimersByTimeAsync(5000);
	expect(answers).toHaveLength(1);
	answers[0]!("one");
	await vi.advanceTimersByTimeAsync(999);
	expect(answers).toHaveLength(1);
	await vi.advanceTimersByTimeAsync(1);
	expect(answers).toHaveLength(2);
	answers[1]!("two");
	await vi.advanceTimersByTimeAsync(1000);
	expect(shown).toEqual(["one", "two"]);
	// Stopped, an answer still on its way is dropped and nothing more is read.
	stop();
	answers[2]!("late");
	await vi.advanceTimersByTimeAsync(5000);
	expect(shown).toEqual(["one", "two"]);
	expect(answers).toHaveLength(3);
	// An answer that says stop reads no more; a failed read reports once and ends.
	more = false;
	const once = pollInOrder(
		1000,
		async () => "done",
		(output) => (shown.push(output), more),
		() => {},
	);
	await vi.advanceTimersByTimeAsync(5000);
	expect(shown.at(-1)).toBe("done");
	expect(shown.filter((s) => s === "done")).toHaveLength(1);
	once();
	const failing = pollInOrder(
		1000,
		() => Promise.reject(new Error("gone")),
		() => true,
		() => shown.push("failed"),
	);
	await vi.advanceTimersByTimeAsync(5000);
	expect(shown.filter((s) => s === "failed")).toHaveLength(1);
	failing();
});
