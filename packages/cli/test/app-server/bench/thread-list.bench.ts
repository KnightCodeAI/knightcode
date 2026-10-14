/**
 * Protocol-level listing benchmark (architecture.md §5.10, §13). Run from the repository root:
 *   bun packages/cli/test/app-server/bench/thread-list.bench.ts 1000
 *   bun packages/cli/test/app-server/bench/thread-list.bench.ts 10000
 * Prints JSONL; creates and removes its own temporary fixtures. No turns or provider requests run.
 * Counters come from server/diagnostics, not direct SessionListingIndex calls. Peak JSC heap is sampled
 * every 2 ms; it is an observed peak, not an exact allocation maximum. Cold means no index, not cold OS caches.
 */

import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppServerContext } from "../../../src/app-server/context.ts";
import { appServerHandlers } from "../../../src/app-server/entry.ts";
import { createInProcessClient } from "../../../src/app-server/in-process.ts";
import { ThreadManager } from "../../../src/app-server/threads.ts";

// Bun-only builtin; keep its narrow, documented contract local rather than adding Bun globals to Node tests.
const { heapStats } = createRequire(import.meta.url)("bun:jsc") as { heapStats(): { heapSize: number } };
const count = Number(process.argv[2] ?? 1000);
assert(Number.isSafeInteger(count) && count > 0, "Session count must be a positive safe integer");
const root = mkdtempSync(join(tmpdir(), "kc-list-bench-"));
const agentDir = join(root, "agent");
const sessionDir = join(root, "sessions");

try {
	mkdirSync(agentDir);
	mkdirSync(sessionDir);
	const header = (id: string, parentSession?: string) =>
		JSON.stringify({
			type: "session",
			version: 3,
			id,
			timestamp: new Date().toISOString(),
			cwd: root,
			...(parentSession ? { parentSession } : {}),
		});
	const userLine = (text: string) =>
		JSON.stringify({
			type: "message",
			id: randomUUID().slice(0, 8),
			parentId: null,
			timestamp: new Date().toISOString(),
			message: { role: "user", content: text, timestamp: Date.now() },
		});
	const fileFor = (id: string) => join(sessionDir, `2026-10-14T00-00-00-000Z_${id}.jsonl`);
	for (let i = 0; i < count; i++) {
		const id = randomUUID();
		writeFileSync(fileFor(id), `${header(id)}\n${userLine(`session ${i}`)}\n`);
	}
	// The index's worst case: one single 100 MiB first message, without retaining a harness-owned 100 MiB string.
	{
		const id = randomUUID();
		const file = fileFor(id);
		const [before, after] = userLine("@@BODY@@").split("@@BODY@@");
		writeFileSync(file, `${header(id)}\n${before}`);
		const piece = "x".repeat(1024 * 1024);
		for (let i = 0; i < 100; i++) appendFileSync(file, piece);
		appendFileSync(file, `${after}\n`);
	}
	// Imported parents deliberately have misleading filename UUIDs. Only their header identity is authoritative.
	for (let i = 0; i < 20; i++) {
		const parentId = randomUUID();
		const parentFile = join(sessionDir, `2026-01-01T00-00-00-000Z_${randomUUID()}.jsonl`);
		writeFileSync(parentFile, `${header(parentId)}\n${userLine(`parent ${i}`)}\n`);
		const forkId = randomUUID();
		writeFileSync(fileFor(forkId), `${header(forkId, parentFile)}\n${userLine(`fork ${i}`)}\n`);
	}
	const fixtureBytes = readdirSync(sessionDir).reduce(
		(total, file) => total + statSync(join(sessionDir, file)).size,
		0,
	);
	const ctx = await createAppServerContext({
		agentDir,
		sessionDir,
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
	});
	const threads = new ThreadManager(ctx);
	const client = createInProcessClient({ handlers: appServerHandlers(ctx, threads), version: "bench" });
	try {
		await client.initialize({ name: "bench" });
		async function measure<T>(label: string, run: () => Promise<T>): Promise<T> {
			const before = await client.request("server/diagnostics", {});
			let peak = heapStats().heapSize;
			const sampler = setInterval(() => (peak = Math.max(peak, heapStats().heapSize)), 2);
			try {
				const started = performance.now();
				const result = await run();
				const ms = performance.now() - started;
				peak = Math.max(peak, heapStats().heapSize);
				const after = await client.request("server/diagnostics", {});
				const filesOpened = after.listingFilesOpened - before.listingFilesOpened;
				const bytesScanned = after.listingBytesScanned - before.listingBytesScanned;
				if (label !== "cold initial") {
					assert.equal(filesOpened, 0, `${label} opened transcripts or parent headers`);
					assert.equal(bytesScanned, 0, `${label} read transcript or parent-header bytes`);
				} else {
					assert.equal(filesOpened, count + 61, "Cold listing must scan each transcript once and one parent per fork");
					assert(bytesScanned >= fixtureBytes, "Cold listing did not read all fixture bytes");
				}
				const indexBytes = statSync(join(sessionDir, ".thread-index.json")).size;
				assert(indexBytes <= 16 * 1024 * 1024, "Index must store bounded titles, not the 100 MiB message");
				console.log(
					JSON.stringify({
						label,
						sessions: count + 41,
						fixtureBytes,
						ms: Number(ms.toFixed(1)),
						filesOpened,
						bytesScanned,
						peakHeapBytes: peak,
						indexBytes,
						runtime: `bun ${process.versions.bun} ${process.platform} ${process.arch}`,
					}),
				);
				return result;
			} finally {
				clearInterval(sampler);
			}
		}
		for (const run of ["cold", "warm"]) {
			let page = await measure(`${run} initial`, () => client.request("thread/list", {}));
			let seen = page.threads.length;
			let continuation = 0;
			while (page.nextCursor) {
				const cursor = page.nextCursor;
				page = await measure(`${run} continuation ${++continuation}`, () => client.request("thread/list", { cursor }));
				seen += page.threads.length;
			}
			assert.equal(seen, count + 41, `${run} pagination lost or duplicated sessions`);
		}
	} finally {
		client.close();
		ctx.dispose();
		await threads.closeAll();
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}
