import { afterEach, expect, test, vi } from "vitest";
import { loadRevisionStyles } from "../../src/renderer/extensions/styles.ts";

const artifact = {
	owner: "example",
	revision: "a".repeat(64),
	root: "/cache",
	frontend: "app.js",
	styles: [],
	files: ["app.js"],
};
afterEach(() => vi.unstubAllGlobals());

test("a shared stylesheet lifetime acquires and releases one native lease", async () => {
	const cleanup = vi.fn();
	let grant!: () => void;
	const acquired = new Promise<() => void>((resolve) => {
		grant = () => resolve(cleanup);
	});
	const acquire = vi.fn(() => acquired);
	const first = loadRevisionStyles(artifact, new AbortController().signal, acquire);
	const second = loadRevisionStyles(artifact, new AbortController().signal, acquire);
	try {
		expect(acquire).toHaveBeenCalledTimes(1);
		grant();
		const [releaseFirst, releaseSecond] = await Promise.all([first, second]);
		releaseFirst();
		expect(cleanup).not.toHaveBeenCalled();
		releaseSecond();
		await Promise.resolve();
		expect(cleanup).toHaveBeenCalledTimes(1);
	} finally {
		grant();
		for (const result of await Promise.allSettled([first, second])) if (result.status === "fulfilled") result.value();
	}
});

test("a cancelled pending acquisition releases its own lease when main grants it", async () => {
	const cleanup = vi.fn();
	let grant!: () => void;
	const acquired = new Promise<() => void>((resolve) => {
		grant = () => resolve(cleanup);
	});
	const controller = new AbortController();
	const pending = loadRevisionStyles(artifact, controller.signal, () => acquired);
	const rejected = expect(pending).rejects.toThrow("cancelled");
	controller.abort();
	try {
		await rejected;
		expect(cleanup).not.toHaveBeenCalled();
		grant();
		await acquired;
		await Promise.resolve();
		expect(cleanup).toHaveBeenCalledTimes(1);
	} finally {
		grant();
		await pending.catch(() => {});
	}
});

test("CSS is not requested before its native lease or after cancellation", async () => {
	const createElement = vi.fn(() => ({ dataset: {}, remove: vi.fn() }));
	vi.stubGlobal("document", { createElement, querySelectorAll: () => [], head: { insertBefore: vi.fn() } });
	let grant!: () => void;
	const acquired = new Promise<() => void>((resolve) => {
		grant = () => resolve(() => {});
	});
	const controller = new AbortController();
	const pending = loadRevisionStyles({ ...artifact, styles: ["app.css"] }, controller.signal, () => acquired);
	const rejected = expect(pending).rejects.toThrow("cancelled");
	try {
		expect(createElement).not.toHaveBeenCalled();
		controller.abort();
		await rejected;
		grant();
		await acquired;
		await Promise.resolve();
		expect(createElement).not.toHaveBeenCalled();
	} finally {
		controller.abort();
		grant();
		await rejected;
		await pending.catch(() => {});
	}
});
