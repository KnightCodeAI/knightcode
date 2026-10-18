import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runGlobalSelfUpdate } from "../src/utils/global-self-update.ts";
import type * as UpdateProcess from "../src/utils/update-process.ts";

const runProcess = vi.hoisted(() => vi.fn());
vi.mock("../src/utils/update-process.ts", async (original) => ({
	...(await original<typeof UpdateProcess>()),
	runUpdateProcess: runProcess,
}));

let root: string;
let packageDir: string;
const command = { command: "npm", args: ["install", "-g", "package@1.0.1"], display: "npm install" };

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "knightcode-global-update-"));
	packageDir = join(root, "package");
	mkdirSync(packageDir, { recursive: true });
	writePackage("1.0.0");
	vi.stubEnv("KNIGHTCODE_CODING_AGENT_DIR", root);
	vi.stubEnv("KNIGHTCODE_PACKAGE_DIR", packageDir);
	runProcess
		.mockReset()
		.mockImplementation(async (_command: string, args: string[]) => (args[1] === "--version" ? "1.0.1" : ""));
});

function writePackage(version: string): void {
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify({ version, bin: { knightcode: "./dist/bundle/cli.js" } }),
	);
}

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe("global updates", () => {
	it("serializes manual and background installs with the same lock", async () => {
		const release = await lockfile.lock(join(root, "self-update"), { realpath: false });
		try {
			await expect(runGlobalSelfUpdate(command, { packageDir, version: "1.0.1" })).rejects.toMatchObject({
				code: "ELOCKED",
			});
			expect(runProcess).not.toHaveBeenCalled();
		} finally {
			await release();
		}
	});

	it("does not downgrade an installation updated by another terminal", async () => {
		writePackage("1.0.2");
		await runGlobalSelfUpdate(command, { packageDir, version: "1.0.1" });
		expect(runProcess).not.toHaveBeenCalled();
	});

	it("rejects an install whose entry point still reports the old version", async () => {
		runProcess.mockImplementation(async (_command: string, args: string[]) => (args[1] === "--version" ? "1.0.0" : ""));
		await expect(runGlobalSelfUpdate(command, { packageDir, version: "1.0.1" })).rejects.toThrow(
			"reports version 1.0.0; expected 1.0.1",
		);
		expect(runProcess).toHaveBeenLastCalledWith(
			process.execPath,
			[join(packageDir, "dist", "bundle", "cli.js"), "--version"],
			expect.objectContaining({ quiet: true }),
		);
	});

	it("stops a running install when the update lock is lost", async () => {
		const realLock = lockfile.lock.bind(lockfile);
		let compromise: ((error: Error) => void) | undefined;
		const spy = vi.spyOn(lockfile, "lock").mockImplementation((file, options) => {
			compromise = options?.onCompromised;
			return realLock(file, options);
		});
		try {
			runProcess.mockImplementation(
				(_command: string, _args: string[], options: { signal: AbortSignal }) =>
					new Promise((_resolve, reject) => {
						options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
						compromise?.(new Error("lock compromised"));
					}),
			);
			await expect(runGlobalSelfUpdate(command, { packageDir, version: "1.0.1" })).rejects.toThrow("lock compromised");
			// The install step was cancelled, so nothing was verified as installed.
			expect(runProcess).toHaveBeenCalledOnce();
		} finally {
			spy.mockRestore();
		}
	});

	it("releases the lock on failure so a later manual attempt can recover", async () => {
		runProcess.mockRejectedValueOnce(new Error("install failed"));
		await expect(runGlobalSelfUpdate(command, { packageDir, version: "1.0.1" })).rejects.toThrow("install failed");
		await expect(runGlobalSelfUpdate(command, { packageDir, version: "1.0.1" })).resolves.toBeUndefined();
		expect(runProcess).toHaveBeenCalledTimes(3);
	});
});
