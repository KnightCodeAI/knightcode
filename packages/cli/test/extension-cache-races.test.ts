import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti, type JitiResolveOptions } from "jiti";
import { afterEach, expect, test, vi } from "vitest";
import {
	clearExtensionCache,
	getExtensionCacheStats,
	loadExtensionsCached,
	releaseExtensionCache,
} from "../src/core/extensions/loader.ts";
import type { LoadExtensionsResult } from "../src/core/extensions/types.ts";

const importing = vi.hoisted(() => ({
	gate: undefined as Promise<void> | undefined,
	entered: undefined as (() => void) | undefined,
	calls: 0,
}));
vi.mock("../src/core/extensions/jiti-loader.ts", () => ({
	createJiti: (...args: Parameters<typeof createJiti>) => {
		const jiti = createJiti(...args);
		const original = jiti.import.bind(jiti);
		jiti.import = async <T>(id: string, options?: JitiResolveOptions & { default?: true }): Promise<T> => {
			importing.calls++;
			const gate = importing.gate;
			importing.entered?.();
			await gate;
			return original<T>(id, options);
		};
		return jiti;
	},
}));
const dirs: string[] = [];
const pending: Promise<LoadExtensionsResult>[] = [];
let release: (() => void) | undefined;
function load(paths: string[], cwd: string) {
	const work = loadExtensionsCached(paths, cwd);
	pending.push(work);
	return work;
}
afterEach(async () => {
	// A failing/timed-out assertion must not let a late import mutate the following test's gate/counters.
	release?.();
	for (const result of await Promise.allSettled(pending.splice(0))) {
		if (result.status === "fulfilled") releaseExtensionCache(result.value.runtime);
	}
	release = undefined;
	importing.gate = undefined;
	importing.entered = undefined;
	importing.calls = 0;
	clearExtensionCache();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
	clearExtensionCache();
	const dir = mkdtempSync(join(tmpdir(), "kc-cache-race-"));
	dirs.push(dir);
	const extension = join(dir, "extension.ts");
	writeFileSync(extension, "export default function () {}\n");
	importing.gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const entered = new Promise<void>((resolve) => {
		importing.entered = resolve;
	});
	return { dir, extension, entered };
}

test("concurrent imports share a promise but own separate runtime leases", async () => {
	const { dir, extension, entered } = fixture();
	const first = load([extension], dir);
	const second = load([extension], dir);
	// Wait on the actual importer boundary, not a polling timeout that includes cold module startup.
	await entered;
	expect(importing.calls).toBe(1);
	expect(getExtensionCacheStats().importing).toBe(1);
	release!();
	const [a, b] = await Promise.all([first, second]);
	expect(a.errors).toEqual([]);
	expect(b.errors).toEqual([]);
	expect(a.runtime).not.toBe(b.runtime);
	releaseExtensionCache(a.runtime);
	expect(getExtensionCacheStats()).toEqual({ active: 1, inactive: 0, importing: 0 });
	releaseExtensionCache(b.runtime);
	expect(getExtensionCacheStats()).toEqual({ active: 0, inactive: 1, importing: 0 });
}, 60_000);

test("a gated old-generation import cannot repopulate the cleared cache", async () => {
	const { dir, extension, entered } = fixture();
	const old = load([extension], dir);
	await entered;
	expect(importing.calls).toBe(1);
	clearExtensionCache();
	importing.gate = undefined;
	const current = await load([extension], dir);
	expect(importing.calls).toBe(2);
	release!();
	const stale = await old;
	expect(stale.errors).toEqual([]);
	expect(getExtensionCacheStats()).toEqual({ active: 1, inactive: 0, importing: 0 });
	releaseExtensionCache(current.runtime);
	releaseExtensionCache(stale.runtime);
	expect(getExtensionCacheStats()).toEqual({ active: 0, inactive: 1, importing: 0 });
	await load([extension], dir);
	expect(importing.calls).toBe(2);
}, 60_000);

test("failed imports leave no factories or pending imports", async () => {
	const { dir } = fixture();
	importing.gate = undefined;
	const result = await load([join(dir, "missing.ts")], dir);
	expect(result.errors).toHaveLength(1);
	expect(getExtensionCacheStats()).toEqual({ active: 0, inactive: 0, importing: 0 });
});
