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
let launcher: string;
const command = { command: "npm", args: ["install", "-g", "package@1.0.1"], display: "npm install" };

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "knightcode-global-update-"));
	const packageDir = join(root, "package");
	mkdirSync(join(packageDir, "bin"), { recursive: true });
	launcher = join(packageDir, "bin", "knightcode");
	writeFileSync(join(packageDir, "package.json"), JSON.stringify({ version: "1.0.0" }));
	// The platform package the launcher resolves; verification runs its binary.
	const platformDir = join(root, "node_modules", "@knightcodeai", `cli-${process.platform}-${process.arch}`);
	mkdirSync(join(platformDir, "bin"), { recursive: true });
	writeFileSync(join(platformDir, "package.json"), JSON.stringify({ name: "platform" }));
	writeFileSync(join(platformDir, "bin", process.platform === "win32" ? "knightcode.exe" : "knightcode"), "");
	vi.stubEnv("KNIGHTCODE_CODING_AGENT_DIR", root);
	vi.stubEnv("KNIGHTCODE_PACKAGE_DIR", packageDir);
	runProcess
		.mockReset()
		.mockImplementation(async (_command: string, args: string[]) => (args[0] === "--version" ? "1.0.1" : ""));
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe("global updates", () => {
	it("serializes manual and background installs with the same lock", async () => {
		const release = await lockfile.lock(join(root, "self-update"), { realpath: false });
		try {
			await expect(runGlobalSelfUpdate(command, { launcher, version: "1.0.1" })).rejects.toMatchObject({
				code: "ELOCKED",
			});
			expect(runProcess).not.toHaveBeenCalled();
		} finally {
			await release();
		}
	});

	it("does not downgrade an installation updated by another terminal", async () => {
		writeFileSync(join(root, "package", "package.json"), JSON.stringify({ version: "1.0.2" }));
		await runGlobalSelfUpdate(command, { launcher, version: "1.0.1" });
		expect(runProcess).not.toHaveBeenCalled();
	});

	it("rejects an install whose platform binary still reports the old version", async () => {
		runProcess.mockImplementation(async (_command: string, args: string[]) => (args[0] === "--version" ? "1.0.0" : ""));
		await expect(runGlobalSelfUpdate(command, { launcher, version: "1.0.1" })).rejects.toThrow(
			"reports version 1.0.0; expected 1.0.1",
		);
		expect(runProcess).toHaveBeenLastCalledWith(
			expect.stringContaining(`cli-${process.platform}-${process.arch}`),
			["--version"],
			expect.objectContaining({ quiet: true }),
		);
	});

	it("releases the lock on failure so a later manual attempt can recover", async () => {
		runProcess.mockRejectedValueOnce(new Error("install failed"));
		await expect(runGlobalSelfUpdate(command, { launcher, version: "1.0.1" })).rejects.toThrow("install failed");
		await expect(runGlobalSelfUpdate(command, { launcher, version: "1.0.1" })).resolves.toBeUndefined();
		expect(runProcess).toHaveBeenCalledTimes(3);
	});
});
