/**
 * Updates (desktop-shell.md section 15), in installed builds only. Windows: Squirrel downloads from the knightcode.dev
 * feed, checked at launch and every 4 hours, and installs on quit. macOS: the same feed says whether a newer release
 * exists, whose page the user downloads it from. Linux: its package manager.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { app, autoUpdater, net } from "electron";
import type { UpdateState } from "../shared/host-protocol.ts";

const FEED = "https://knightcode.dev/api/desktop/update";
const EVERY_MS = 4 * 60 * 60 * 1000;
const RELEASES = "https://github.com/KnightCodeAI/knightcode/releases/";

/**
 * Squirrel runs the app with `--squirrel-*` after it installs, updates or removes it, and waits for it to quit:
 * shortcuts made or removed, the link scheme dropped on removal. True when this launch is one of those.
 */
/** Squirrel's Update.exe, beside the version directories of an installed app; absent from an unpacked build. */
const updateExe = () => join(dirname(process.execPath), "..", "Update.exe");

export function squirrelEvent(): boolean {
	if (process.platform !== "win32") return false;
	const update = updateExe();
	const exe = basename(process.execPath);
	const run = (args: string[]) =>
		spawn(update, args, { detached: true, stdio: "ignore" })
			.on("close", () => app.exit(0))
			.on("error", () => app.exit(0));
	switch (process.argv[1]) {
		case "--squirrel-install":
		case "--squirrel-updated":
			run([`--createShortcut=${exe}`]);
			return true;
		case "--squirrel-uninstall":
			app.removeAsDefaultProtocolClient("knightcode");
			run([`--removeShortcut=${exe}`]);
			return true;
		case "--squirrel-obsolete":
			app.exit(0);
			return true;
	}
	return false;
}

/**
 * Squirrel's errors carry Update.exe's whole .NET stack ("Command failed: 4294967295 System.AggregateException: ...
 * ---> System.Net.WebException: The remote server returned an error: (404) Not Found. at ..."): its innermost message.
 */
export function squirrelMessage(message: string): string {
	const innermost = message.split(" at ")[0]!.split("---> ").at(-1)!;
	return innermost.replace(/^(Command failed: -?\d+ )?[\w.]+Exception: /, "").trim() || message;
}

export class Updates {
	state: UpdateState;
	private readonly onState: (state: UpdateState) => void;

	constructor(onState: (state: UpdateState) => void) {
		this.onState = onState;
		const installed =
			app.isPackaged && (process.platform === "darwin" || (process.platform === "win32" && existsSync(updateExe())));
		this.state = installed ? { state: "idle" } : { state: "unavailable" };
	}

	start(): void {
		if (this.state.state === "unavailable") return;
		if (process.platform === "win32") {
			autoUpdater.setFeedURL({ url: `${FEED}/win32-${process.arch}/${app.getVersion()}` });
			autoUpdater.on("checking-for-update", () => this.set({ state: "checking" }));
			autoUpdater.on("update-available", () => this.set({ state: "downloading" }));
			autoUpdater.on("update-not-available", () => this.set({ state: "idle", checkedAt: Date.now() }));
			autoUpdater.on("update-downloaded", (_event, _notes, name) =>
				this.set({ state: "ready", ...(name ? { version: name } : {}) }),
			);
			autoUpdater.on("error", (error) =>
				this.set({ state: "idle", checkedAt: Date.now(), error: squirrelMessage(error.message) }),
			);
		}
		// Update.exe still holds the install on the first launch after it; the next check is the interval's or the user's.
		if (!process.argv.includes("--squirrel-firstrun")) void this.check();
		setInterval(() => void this.check(), EVERY_MS);
	}

	async check(): Promise<UpdateState> {
		const { state } = this.state;
		if (state === "unavailable" || state === "checking" || state === "downloading" || state === "ready")
			return this.state;
		if (process.platform === "win32") {
			// The events above carry the outcome.
			this.set({ state: "checking" });
			autoUpdater.checkForUpdates();
			return this.state;
		}
		this.set({ state: "checking" });
		try {
			// A request that never answers would leave the state checking, and every later check would wait on it.
			const response = await net.fetch(`${FEED}/darwin-${process.arch}/${app.getVersion()}`, {
				signal: AbortSignal.timeout(30_000),
			});
			if (response.status === 204) this.set({ state: "idle", checkedAt: Date.now() });
			else if (!response.ok) throw new Error(`The update feed answered ${response.status}.`);
			else {
				const { version, url } = (await response.json()) as { version?: unknown; url?: unknown };
				// The page is opened in the browser: only a release page of this repository, for a real version.
				if (
					typeof version !== "string" ||
					!/^\d+\.\d+\.\d+$/.test(version) ||
					typeof url !== "string" ||
					!url.startsWith(RELEASES)
				)
					throw new Error("The update feed answered something that is not a release.");
				this.set({ state: "available", version, url });
			}
		} catch (error) {
			this.set({ state: "idle", checkedAt: Date.now(), error: error instanceof Error ? error.message : String(error) });
		}
		return this.state;
	}

	/** Windows, once downloaded: Squirrel swaps the version in as the app quits. */
	install(): void {
		if (this.state.state === "ready") autoUpdater.quitAndInstall();
	}

	private set(state: UpdateState): void {
		this.state = state;
		this.onState(state);
	}
}
