import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	createFdLister,
	FileSearch,
	fuzzyScore,
	type ListFiles,
	type Listing,
} from "../../src/app-server/file-search.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

const tick = () => new Promise((resolve) => setImmediate(resolve));
const fakeFd = (code: number, repeat: number, lines: string[], maxStdoutBytes?: number) =>
	createFdLister({
		command: process.execPath,
		args: [join(import.meta.dirname, "fixtures/fake-fd.mjs"), String(code), String(repeat), ...lines, "--"],
		maxStdoutBytes,
	});

/** Listings the test finishes by hand; records each call's signal and the most that ran at once. */
function manualListings() {
	const calls: Array<{ cwd: string; signal: AbortSignal; done: boolean; finish: (files: string[]) => void }> = [];
	let active = 0;
	let maxActive = 0;
	const list: ListFiles = (cwd, signal) =>
		new Promise<Listing>((resolve, reject) => {
			active++;
			maxActive = Math.max(maxActive, active);
			const call = {
				cwd,
				signal,
				done: false,
				finish: (files: string[]) => {
					if (call.done) return;
					call.done = true;
					active--;
					resolve({ files, truncated: false, cacheable: true });
				},
			};
			signal.addEventListener(
				"abort",
				() => {
					if (call.done) return;
					call.done = true;
					active--;
					reject(signal.reason);
				},
				{ once: true },
			);
			calls.push(call);
		});
	return { list, calls, maxActive: () => maxActive };
}

test("fuzzyScore prefers contiguous and basename matches", () => {
	const a = fuzzyScore("thrds", "packages/cli/src/app-server/threads.ts")!;
	const b = fuzzyScore("thrds", "packages/cli/src/app-server/transcript-handler-ids.ts");
	expect(a.indices).toHaveLength(5);
	expect(b === undefined || a.score > b.score).toBe(true);
	expect(fuzzyScore("xyz", "threads.ts")).toBeUndefined();
});

test("file/search lists project files with the real fd, respects .gitignore, and ranks (§4.4)", async () => {
	const { cwd, connect } = await startServer();
	execFileSync("git", ["init", "-q"], { cwd });
	mkdirSync(join(cwd, "src", "app-server"), { recursive: true });
	writeFileSync(join(cwd, "src", "app-server", "threads.ts"), "");
	writeFileSync(join(cwd, "src", "app-server", "transcript.ts"), "");
	mkdirSync(join(cwd, "dist"));
	writeFileSync(join(cwd, "dist", "threads.js"), "");
	writeFileSync(join(cwd, ".gitignore"), "dist/\n");
	const a = await connect();
	const result = await a.client.request("file/search", { cwd, query: "thrds" });
	expect(result.truncated).toBe(false);
	expect(result.files[0].path).toBe("src/app-server/threads.ts");
	expect(result.files.some((f) => f.path.startsWith("dist"))).toBe(false);
});

test("real fd reports count truncation even with exit code zero; exactly at the cap is complete", async () => {
	const { cwd } = await startServer();
	const dir = join(cwd, "count-cap");
	mkdirSync(dir);
	writeFileSync(join(dir, "a.ts"), "");
	writeFileSync(join(dir, "b.ts"), "");
	const list = createFdLister({ maxFiles: 2 });
	const signal = new AbortController().signal;
	const exact = await list(dir, signal);
	expect(exact.files.sort()).toEqual(["a.ts", "b.ts"]);
	expect(exact).toMatchObject({ truncated: false, cacheable: true });
	writeFileSync(join(dir, "c.ts"), "");
	const capped = await list(dir, signal);
	expect(capped.files).toHaveLength(2); // ordering is fd's, not a fixture assumption
	expect(capped).toMatchObject({ truncated: true, cacheable: true });
	const search = new FileSearch({ list: async () => capped });
	expect((await search.search({ cwd: dir, query: ".ts" })).truncated).toBe(true);
	search.close();
});

test("a superseded search answers at once, and its listing is aborted when nobody else waits for it", async () => {
	const m = manualListings();
	const search = new FileSearch({ list: m.list });
	const older = search.search({ cwd: "/x", query: "a", searchId: "s" });
	const newer = search.search({ cwd: "/y", query: "b", searchId: "s" });
	expect(await older).toEqual({ files: [], truncated: false }); // although /x's listing never finished
	expect(m.calls[0].signal.aborted).toBe(true); // nobody waits for /x any more: its process is stopped
	m.calls[1].finish(["src/b.ts"]);
	expect((await newer).files.map((f) => f.path)).toEqual(["src/b.ts"]);
});

test("ten cwds at once: at most 2 listings run, and listings evicted while pending still serve their waiters", async () => {
	const m = manualListings();
	const search = new FileSearch({ list: m.list });
	const searches = Array.from({ length: 10 }, (_, i) => search.search({ cwd: `/c${i}`, query: "a" }));
	await tick();
	expect(m.calls).toHaveLength(2); // the rest queue for a slot
	// Ten cwds against a cache of 8: /c0 and /c1 were evicted while running, but their searches still wait on them.
	expect(m.calls[0].signal.aborted).toBe(false);
	expect(m.calls[1].signal.aborted).toBe(false);
	for (let round = 0; round < 50 && (m.calls.length < 10 || m.calls.some((c) => !c.done)); round++) {
		for (const c of m.calls) c.finish(["a.ts"]);
		await tick();
	}
	const results = await Promise.all(searches);
	expect(results.every((r) => r.files.length === 1)).toBe(true);
	expect(m.calls).toHaveLength(10);
	expect(m.maxActive()).toBeLessThanOrEqual(2);
});

test("a listing aborted while queued for a slot does not swallow the next hand-off", async () => {
	const m = manualListings();
	const search = new FileSearch({ list: m.list });
	const a = search.search({ cwd: "/a", query: "a", searchId: "s1" });
	const b = search.search({ cwd: "/b", query: "a", searchId: "s2" });
	const c = search.search({ cwd: "/c", query: "a", searchId: "s3" }); // queued for a slot
	const d = search.search({ cwd: "/d", query: "a" }); // queued behind it
	const e = search.search({ cwd: "/e", query: "a", searchId: "s3" }); // supersedes c: its queued listing aborts
	expect((await c).files).toEqual([]);
	m.calls[0].finish(["a.ts"]); // frees a slot: it must reach d or e, not c's withdrawn waiter
	await tick();
	await tick();
	expect(m.calls).toHaveLength(3);
	for (let round = 0; round < 20; round++) {
		for (const call of m.calls) call.finish(["a.ts"]);
		await tick();
	}
	await Promise.all([a, b, d, e]);
	expect(m.maxActive()).toBeLessThanOrEqual(2);
});

test("listings are cached briefly; failed and partial listings are not", async () => {
	let now = 0;
	let calls = 0;
	const outcomes: Array<() => Promise<Listing>> = [
		async () => {
			throw new Error("fd exited 2: boom");
		},
		async () => ({ files: ["a.ts"], truncated: true, cacheable: false }), // partial: served, not cached
		async () => ({ files: ["a.ts"], truncated: false, cacheable: true }),
	];
	const search = new FileSearch({ now: () => now, list: () => outcomes[Math.min(calls++, 2)]() });
	await expect(search.search({ cwd: "/p", query: "a" })).rejects.toMatchObject({ code: "internal" });
	expect((await search.search({ cwd: "/p", query: "a" })).truncated).toBe(true);
	await search.search({ cwd: "/p", query: "a" }); // listed again: neither earlier outcome was cached
	await search.search({ cwd: "/p", query: "a" }); // cached
	expect(calls).toBe(3);
	now += 10_001;
	await search.search({ cwd: "/p", query: "a" }); // expired
	expect(calls).toBe(4);
});

test("the fd lister: errors with no output fail, errors after output are partial, the byte cap truncates, abort stops it", async () => {
	const signal = new AbortController().signal;
	await expect(fakeFd(2, 1, [])("/", signal)).rejects.toThrow(/exited 2/);
	expect(await fakeFd(1, 1, ["a.ts", "b.ts"])("/", signal)).toEqual({
		files: ["a.ts", "b.ts"],
		truncated: true,
		cacheable: false,
	});
	expect(await fakeFd(0, 1, ["a.ts"])("/", signal)).toEqual({ files: ["a.ts"], truncated: false, cacheable: true });
	const capped = await fakeFd(0, 10_000, ["src/some/long/path/name.ts"], 1024)("/", signal);
	expect(capped.truncated && capped.cacheable).toBe(true);
	expect(capped.files.join("\n").length).toBeLessThanOrEqual(1024);
	expect(capped.files.length > 0 && capped.files.every((f) => f === "src/some/long/path/name.ts")).toBe(true); // complete lines only
	const aborter = new AbortController();
	const pending = fakeFd(0, 1, ["a.ts"])("/", aborter.signal);
	aborter.abort(new Error("stop"));
	await expect(pending).rejects.toThrow("stop");
});

test("close() ends running listings; later searches answer shuttingDown", async () => {
	const m = manualListings();
	const search = new FileSearch({ list: m.list });
	const running = search.search({ cwd: "/p", query: "a" });
	await tick(); // the listing has started
	search.close();
	await expect(running).rejects.toMatchObject({ code: "shuttingDown" });
	expect(m.calls[0].signal.aborted).toBe(true);
	await expect(search.search({ cwd: "/p", query: "a" })).rejects.toMatchObject({ code: "shuttingDown" });
});

test("closing a search waiting on a real subprocess answers shuttingDown, not superseded", async () => {
	const { cwd } = await startServer();
	let enter!: () => void;
	const entered = new Promise<void>((r) => {
		enter = r;
	});
	const list = fakeFd(99, 1, ["a.ts"]);
	const search = new FileSearch({
		list: (dir, signal) => {
			const pending = list(dir, signal);
			enter();
			return pending;
		},
	});
	const running = search.search({ cwd, query: "a", searchId: "real-child" });
	await entered;
	search.close();
	await expect(running).rejects.toMatchObject({ code: "shuttingDown" });
});

test("shutdown beats superseding even when the child's rejection waits for close", async () => {
	let enter!: () => void, closeChild!: () => void;
	const entered = new Promise<void>((r) => {
		enter = r;
	});
	const closed = new Promise<void>((r) => {
		closeChild = r;
	});
	const search = new FileSearch({
		list: (_cwd, signal) =>
			new Promise<Listing>((_resolve, reject) => {
				enter();
				signal.addEventListener(
					"abort",
					() => {
						void closed.then(() => reject(signal.reason));
					},
					{ once: true },
				);
			}),
	});
	const pending = search.search({ cwd: "/p", query: "a", searchId: "composer" });
	await entered;
	try {
		search.close();
		await expect(pending).rejects.toMatchObject({ code: "shuttingDown" });
	} finally {
		closeChild();
	}
});
