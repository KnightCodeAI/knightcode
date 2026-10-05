import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUpdateProcess } from "../src/utils/update-process.ts";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "knightcode-update-process-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

describe("update processes", () => {
	it("kills a stalled package manager, not just its wrapper, when the step times out", async () => {
		const pidFile = join(root, "pid");
		const script = join(root, "stall.mjs");
		writeFileSync(
			script,
			`import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`,
		);
		// npm on Windows is npm.cmd, so the process that stalls is a grandchild behind cmd.exe.
		let command = process.execPath;
		let args = [script];
		if (process.platform === "win32") {
			command = join(root, "stall.cmd");
			writeFileSync(command, `@"${process.execPath}" "${script}"\r\n`);
			args = [];
		}

		const pending = runUpdateProcess(command, args, { quiet: true, signal: AbortSignal.timeout(1500) });
		await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });

		expect(existsSync(pidFile)).toBe(true);
		const pid = Number(readFileSync(pidFile, "utf8"));
		const deadline = Date.now() + 10_000;
		while (isAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
		expect(isAlive(pid)).toBe(false);
	}, 20_000);
});
