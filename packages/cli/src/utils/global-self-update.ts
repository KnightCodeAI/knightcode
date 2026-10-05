import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir, getPackageDir, PLATFORM_BINARY_SPECIFIER, type SelfUpdateCommand } from "../config.ts";
import { runUpdateProcess, UPDATE_STEP_TIMEOUT_MS } from "./update-process.ts";
import { comparePackageVersions } from "./version-check.ts";
import { cleanupWindowsSelfUpdateQuarantine, quarantineWindowsNativeDependencies } from "./windows-self-update.ts";

// Archive extraction is synchronous and can starve the lock's heartbeat; the
// default 10 s would let another terminal steal a live lock mid-install.
const SELF_UPDATE_LOCK = { realpath: false, stale: 120_000 } as const;

/** One in-place update per user at a time, whatever the install method or caller. */
export async function withSelfUpdateLock<T>(run: () => Promise<T>): Promise<T> {
	const agentDir = getAgentDir();
	mkdirSync(agentDir, { recursive: true });
	const releaseLock = await lockfile.lock(join(agentDir, "self-update"), {
		...SELF_UPDATE_LOCK,
		// The default handler throws from a timer and crashes the process.
		onCompromised: () => {},
	});
	try {
		return await run();
	} finally {
		await releaseLock().catch(() => {});
	}
}

/** Startup cleanup that must not race a live update. */
export function trySelfUpdateLockSync(run: () => void): void {
	try {
		const releaseLock = lockfile.lockSync(join(getAgentDir(), "self-update"), SELF_UPDATE_LOCK);
		try {
			run();
		} finally {
			releaseLock();
		}
	} catch {
		// An update is running, or the agent dir does not exist yet.
	}
}

export async function runGlobalSelfUpdate(
	command: SelfUpdateCommand,
	options: { version?: string; launcher?: string } = {},
): Promise<void> {
	await withSelfUpdateLock(async () => {
		// Recheck after acquiring the same lock that manual and background updates use.
		if (options.version && options.launcher) {
			const metadata = JSON.parse(readFileSync(join(dirname(dirname(options.launcher)), "package.json"), "utf8")) as {
				version?: string;
			};
			if ((comparePackageVersions(metadata.version ?? "", options.version) ?? -1) >= 0) return;
		}
		if (process.platform === "win32") {
			cleanupWindowsSelfUpdateQuarantine(getPackageDir());
			quarantineWindowsNativeDependencies(getPackageDir());
		}
		for (const step of command.steps ?? [command]) {
			await runUpdateProcess(step.command, step.args, { signal: AbortSignal.timeout(UPDATE_STEP_TIMEOUT_MS) });
		}
		if (options.version && options.launcher) {
			// Run what the launcher will run: the platform binary, not the JS shim, so
			// a skipped optional dependency fails here instead of on the next start.
			const binary = createRequire(options.launcher).resolve(PLATFORM_BINARY_SPECIFIER);
			const installed = await runUpdateProcess(binary, ["--version"], {
				quiet: true,
				signal: AbortSignal.timeout(30_000),
			});
			if ((comparePackageVersions(installed, options.version) ?? -1) < 0) {
				throw new Error(`Installed ${binary} reports version ${installed}; expected ${options.version}.`);
			}
		}
	});
}
