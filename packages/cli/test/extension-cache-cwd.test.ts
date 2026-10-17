import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import type { ExtensionRuntime } from "../src/core/extensions/types.ts";
import {
	clearExtensionCache,
	getExtensionCacheStats,
	loadExtensionsCached,
	MAX_INACTIVE_EXTENSION_FACTORIES,
	releaseExtensionCache,
} from "../src/core/extensions/loader.ts";

const dirs: string[] = [];
const leased: ExtensionRuntime[] = [];
afterEach(() => {
	// Bare loadExtensionsCached callers own their result runtime's leases (Step 3).
	for (const runtime of leased.splice(0)) releaseExtensionCache(runtime);
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	clearExtensionCache();
});

test("loading extensions for a second cwd does not evict the first cwd's modules", async () => {
	const a = mkdtempSync(join(tmpdir(), "knightcode-cache-a-"));
	const b = mkdtempSync(join(tmpdir(), "knightcode-cache-b-"));
	dirs.push(a, b);
	const extension = join(a, "counter.ts");
	// Module state counts evaluations; a cache hit does not re-evaluate.
	writeFileSync(
		extension,
		"globalThis.__kcEvaluations = (globalThis.__kcEvaluations ?? 0) + 1;\nexport default function () {}\n",
	);
	const evaluations = () => (globalThis as { __kcEvaluations?: number }).__kcEvaluations ?? 0;
	const before = evaluations();
	for (const cwd of [a, b, a]) leased.push((await loadExtensionsCached([extension], cwd)).runtime);
	expect(evaluations() - before).toBe(2);
});

test("300 live factories stay pinned; releasing them retains only 256 inactive LRU entries", async () => {
	clearExtensionCache();
	const dir = mkdtempSync(join(tmpdir(), "kc-cache-bounded-"));
	dirs.push(dir);
	const extension = join(dir, "empty.ts");
	writeFileSync(extension, "export default function () {}\n");
	for (let i = 0; i < 300; i++) leased.push((await loadExtensionsCached([extension], join(dir, String(i)))).runtime);
	expect(getExtensionCacheStats()).toEqual({ active: 300, inactive: 0, importing: 0 });
	for (const runtime of leased.splice(0)) releaseExtensionCache(runtime);
	expect(getExtensionCacheStats()).toEqual({ active: 0, inactive: MAX_INACTIVE_EXTENSION_FACTORIES, importing: 0 });
});

test("failed factories release their pin and disposal is idempotent", async () => {
	clearExtensionCache();
	const dir = mkdtempSync(join(tmpdir(), "kc-cache-failed-"));
	dirs.push(dir);
	const extension = join(dir, "broken.ts");
	writeFileSync(extension, "export default function () { throw new Error('failed factory'); }\n");
	const result = await loadExtensionsCached([extension], dir);
	leased.push(result.runtime);
	expect(result.errors[0].error).toContain("failed factory");
	expect(getExtensionCacheStats().active).toBe(0);
	releaseExtensionCache(result.runtime);
	releaseExtensionCache(result.runtime);
	expect(getExtensionCacheStats().active).toBe(0);
});
