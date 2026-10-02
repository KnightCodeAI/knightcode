import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./fixtures/bun-sqlite.ts", import.meta.url));
const hasBun = spawnSync("bun", ["--version"], { shell: process.platform === "win32" }).status === 0;

// The compiled CLI runs on Bun, which has bun:sqlite but no node:sqlite.
describe.skipIf(!hasBun)("Bun SQLite adapter", () => {
	it("runs statements, transactions and storage migrations, and releases the file on close", () => {
		const result = spawnSync("bun", [fixture], { encoding: "utf8", shell: process.platform === "win32" });
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			missing: true,
			journal: "wal",
			rollbackError: "boom",
			rows: ["a", "b"],
		});
	}, 30_000);
});
