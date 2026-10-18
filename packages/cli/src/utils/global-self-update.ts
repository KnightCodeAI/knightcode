import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { APP_NAME, getAgentDir, getPackageDir, type SelfUpdateCommand } from "../config.ts";
import { runUpdateProcess, UPDATE_STEP_TIMEOUT_MS } from "./update-process.ts";
import { comparePackageVersions } from "./version-check.ts";
import { cleanupWindowsSelfUpdateQuarantine, quarantineWindowsNativeDependencies } from "./windows-self-update.ts";

// Archive extraction is synchronous and can starve the lock's heartbeat; the
// default 10 s would let another terminal steal a live lock mid-install.
const SELF_UPDATE_LOCK = { realpath: false, stale: 120_000 } as const;

/**
 * One in-place update per user at a time, whatever the install method or caller.
 * `run` receives a signal that aborts if the lock is lost, at which point another
 * terminal may already be updating; stop before touching the install.
 */
export async function withSelfUpdateLock<T>(run: (lockLost: AbortSignal) => Promise<T>): Promise<T> {
	const agentDir = getAgentDir();
	mkdirSync(agentDir, { recursive: true });
	const lockLost = new AbortController();
	const releaseLock = await lockfile.lock(join(agentDir, "self-update"), {
		...SELF_UPDATE_LOCK,
		// The default handler throws from a timer and crashes the process.
		onCompromised: (error) => lockLost.abort(error),
	});
	try {
		return await run(lockLost.signal);
	} finally {
		await releaseLock().catch(() => {});
	}
}

/** Startup cleanup that must not race a live update. */
export function trySelfUpdateLockSync(run: () => void): void {
	try {
		mkdirSync(getAgentDir(), { recursive: true });
		const releaseLock = lockfile.lockSync(join(getAgentDir(), "self-update"), SELF_UPDATE_LOCK);
		try {
			run();
		} finally {
			releaseLock();
		}
	} catch {
		// An update is running, or the agent dir is not writable.
	}
}

export async function runGlobalSelfUpdate(
	command: SelfUpdateCommand,
	options: { version?: string; packageDir?: string } = {},
): Promise<void> {
	await withSelfUpdateLock(async (lockLost) => {
		const readInstalled = (packageDir: string) =>
			JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
				version?: string;
				bin?: string | Record<string, string>;
			};
		// Recheck after acquiring the same lock that manual and background updates use.
		if (options.version && options.packageDir) {
			const installed = readInstalled(options.packageDir);
			if ((comparePackageVersions(installed.version ?? "", options.version) ?? -1) >= 0) return;
		}
		if (process.platform === "win32") {
			cleanupWindowsSelfUpdateQuarantine(getPackageDir());
			quarantineWindowsNativeDependencies(getPackageDir());
		}
		for (const step of command.steps ?? [command]) {
			await runUpdateProcess(step.command, step.args, {
				signal: AbortSignal.any([lockLost, AbortSignal.timeout(UPDATE_STEP_TIMEOUT_MS)]),
			});
		}
		if (options.version && options.packageDir) {
			// Start the installed entry point the way the next session will, so a
			// broken or partial install fails here instead of on the next start.
			const { bin } = readInstalled(options.packageDir);
			const entry = join(options.packageDir, (typeof bin === "string" ? bin : bin?.[APP_NAME]) ?? "");
			const installed = await runUpdateProcess(process.execPath, [entry, "--version"], {
				quiet: true,
				signal: AbortSignal.timeout(30_000),
			});
			if ((comparePackageVersions(installed, options.version) ?? -1) < 0) {
				throw new Error(`Installed ${entry} reports version ${installed}; expected ${options.version}.`);
			}
		}
	});
}
