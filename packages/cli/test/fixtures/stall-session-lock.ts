/**
 * Holds a session file's lock, then stalls its event loop until the gate file exists, as a process
 * whose laptop slept would. Then exits, after releasing (`release`) or without (`exit`).
 */
import { existsSync } from "node:fs";
import { acquireSessionLock } from "../../src/core/session-lock.ts";

const [file, gate, mode] = process.argv.slice(2);
const lock = acquireSessionLock(file, { staleMs: 2_000, updateMs: 1_000 });
process.stdout.write("taken\n", () => {
	// Busy-wait: no timer, so no refresh, runs while the lock goes stale.
	while (!existsSync(gate)) {
		// stalled
	}
	process.stdout.write(`lost=${lock.lost}\n`);
	if (mode === "release") lock.release();
	// proper-lockfile's exit handler runs here.
	process.exit(0);
});
