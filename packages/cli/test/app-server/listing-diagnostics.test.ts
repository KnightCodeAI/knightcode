import { statSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { SessionManager } from "../../src/core/session-manager.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

test("protocol diagnostics count cold transcript scans and remain unchanged on a fresh warm listing", async () => {
	const { cwd, sessionDir, connect } = await startServer();
	const files: string[] = [];
	for (let i = 0; i < 2; i++) {
		const manager = SessionManager.create(cwd, sessionDir);
		manager.appendMessage({ role: "user", content: [{ type: "text", text: `saved ${i}` }], timestamp: Date.now() });
		files.push(manager.getSessionFile()!);
		manager.close();
	}
	const a = await connect();
	const before = await a.client.request("server/diagnostics", {});
	const first = await a.client.request("thread/list", { cwd });
	expect(first.threads).toHaveLength(2);
	const cold = await a.client.request("server/diagnostics", {});
	expect(cold.listingFilesOpened - before.listingFilesOpened).toBeGreaterThanOrEqual(2);
	expect(cold.listingBytesScanned - before.listingBytesScanned).toBeGreaterThanOrEqual(
		files.reduce((sum, file) => sum + statSync(file).size, 0),
	);
	const warm = await a.client.request("thread/list", { cwd });
	expect(warm.threads).toEqual(first.threads);
	const after = await a.client.request("server/diagnostics", {});
	expect(after.listingFilesOpened).toBe(cold.listingFilesOpened);
	expect(after.listingBytesScanned).toBe(cold.listingBytesScanned);
});
