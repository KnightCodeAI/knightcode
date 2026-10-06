import { spawn } from "node:child_process";
import { valid } from "semver";
import { isBunBinary, PACKAGE_NAME } from "../config.ts";
import { waitForChildProcess } from "./child-process.ts";
import { getActiveManagedInstallRoot, runManagedSelfUpdate } from "./managed-self-update.ts";
import { UPDATE_EXIT_LOCKED, UPDATE_EXIT_UNSUPPORTED } from "./update-process.ts";
import { checkForNewPiVersion, comparePackageVersions, type LatestPiRelease } from "./version-check.ts";

export type BackgroundUpdateState = {
	release: LatestPiRelease;
	phase: "available" | "downloading" | "verifying" | "ready" | "failed" | "waiting";
};

/** One updater per interactive process. Package changes are serialized across terminals. */
export class BackgroundUpdater {
	private readonly currentVersion: string;
	private readonly onState: (state: BackgroundUpdateState) => void;
	private readonly getAutoUpdate: () => boolean;
	private timer: NodeJS.Timeout | undefined;
	private controller = new AbortController();
	private running = false;
	private stopped = false;
	private ready = false;

	constructor(currentVersion: string, onState: (state: BackgroundUpdateState) => void, getAutoUpdate: () => boolean) {
		this.currentVersion = currentVersion;
		this.onState = onState;
		this.getAutoUpdate = getAutoUpdate;
	}

	start(): void {
		if (this.timer || this.stopped) return;
		void this.check();
		this.timer = setInterval(() => void this.check(), 60 * 60 * 1000);
		this.timer.unref();
	}

	stop(): void {
		this.stopped = true;
		if (this.timer) clearInterval(this.timer);
		this.controller.abort();
	}

	async check(): Promise<void> {
		if (
			this.running ||
			this.stopped ||
			this.ready ||
			process.env.KNIGHTCODE_OFFLINE ||
			process.env.KNIGHTCODE_SKIP_VERSION_CHECK
		)
			return;
		this.running = true;
		let release: LatestPiRelease | undefined;
		const emit = (phase: BackgroundUpdateState["phase"]) => {
			if (release && !this.stopped) this.onState({ release, phase });
		};
		try {
			release = await checkForNewPiVersion(this.currentVersion);
			if (!release || this.stopped) return;
			// Package renames can uninstall the old package; keep that an explicit action.
			if (
				!valid(release.version) ||
				(comparePackageVersions(release.version, this.currentVersion) ?? -1) <= 0 ||
				(release.packageName && release.packageName !== PACKAGE_NAME) ||
				process.env.KNIGHTCODE_DISABLE_AUTO_UPDATE ||
				!this.getAutoUpdate()
			) {
				emit("available");
				return;
			}
			const managedRoot = getActiveManagedInstallRoot();
			if (managedRoot) {
				const version = await runManagedSelfUpdate(managedRoot, release.version, {
					quiet: true,
					signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10 * 60 * 1000)]),
					onProgress: emit,
				});
				release = { ...release, version };
			} else {
				// Development runs and a KNIGHTCODE_BIN_PATH override (often a local build)
				// must never be replaced by a release.
				if (!isBunBinary || process.env.KNIGHTCODE_BIN_PATH) {
					emit("available");
					return;
				}
				emit("downloading");
				// The worker decides how this install updates. Its detection spawns package
				// managers synchronously, which would freeze this TUI for about a second.
				// It owns its lock, must finish even if the user exits, and never inherits
				// terminal handles or writes into the TUI.
				const worker = spawn(process.execPath, ["update", "--self"], {
					stdio: "ignore",
					detached: true,
					windowsHide: true,
					env: {
						...process.env,
						KNIGHTCODE_SELF_UPDATE_VERSION: release.version,
						npm_config_fetch_timeout: "30000",
						npm_config_fetch_retries: "2",
					},
				});
				worker.unref();
				const code = await waitForChildProcess(worker);
				if (code === UPDATE_EXIT_UNSUPPORTED) {
					emit("available");
					return;
				}
				if (code !== 0)
					throw Object.assign(new Error("Background update failed"), {
						code: code === UPDATE_EXIT_LOCKED ? "ELOCKED" : "EUPDATE",
					});
			}
			this.ready = true;
			emit("ready");
		} catch (error) {
			emit(error instanceof Error && "code" in error && error.code === "ELOCKED" ? "waiting" : "failed");
		} finally {
			this.running = false;
		}
	}
}
