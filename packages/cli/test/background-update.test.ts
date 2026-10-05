import { ChildProcess } from "node:child_process";
import type * as NodeChildProcess from "node:child_process";
import type * as Config from "../src/config.ts";
import type * as VersionCheck from "../src/utils/version-check.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundUpdater, type BackgroundUpdateState } from "../src/utils/background-update.ts";

const mocks = vi.hoisted(() => ({
	check: vi.fn(),
	managedRoot: vi.fn(),
	managedUpdate: vi.fn(),
	spawn: vi.fn(),
}));

vi.mock("../src/config.ts", async (original) => ({
	...(await original<typeof Config>()),
	isBunBinary: true,
}));
vi.mock("../src/utils/version-check.ts", async (original) => ({
	...(await original<typeof VersionCheck>()),
	checkForNewPiVersion: mocks.check,
}));
vi.mock("../src/utils/managed-self-update.ts", () => ({
	getActiveManagedInstallRoot: mocks.managedRoot,
	runManagedSelfUpdate: mocks.managedUpdate,
}));
vi.mock("node:child_process", async (original) => ({
	...(await original<typeof NodeChildProcess>()),
	spawn: mocks.spawn,
}));

let updater: BackgroundUpdater;
let states: BackgroundUpdateState[];

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv("KNIGHTCODE_OFFLINE", undefined);
	vi.stubEnv("KNIGHTCODE_SKIP_VERSION_CHECK", undefined);
	vi.stubEnv("KNIGHTCODE_DISABLE_AUTO_UPDATE", undefined);
	vi.stubEnv("KNIGHTCODE_BIN_PATH", undefined);
	states = [];
	updater = new BackgroundUpdater("1.0.0", (state) => states.push(state));
	mocks.check.mockResolvedValue({ version: "1.0.1" });
	mocks.managedRoot.mockReturnValue("managed");
	mocks.managedUpdate.mockImplementation(async (_root, version, options) => {
		options.onProgress("downloading");
		options.onProgress("verifying");
		return version;
	});
});

afterEach(() => {
	updater.stop();
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("background updates", () => {
	it("shows ready only after a managed release has been verified and activated", async () => {
		await updater.check();
		expect(states.map((state) => state.phase)).toEqual(["downloading", "verifying", "ready"]);
		expect(mocks.managedUpdate).toHaveBeenCalledWith("managed", "1.0.1", expect.objectContaining({ quiet: true }));
	});

	it.each(["KNIGHTCODE_OFFLINE", "KNIGHTCODE_SKIP_VERSION_CHECK"])(
		"skips automatic network activity with %s",
		async (variable) => {
			vi.stubEnv(variable, "1");
			await updater.check();
			expect(mocks.check).not.toHaveBeenCalled();
		},
	);

	it("keeps a manual update notice when automatic downloads are disabled", async () => {
		vi.stubEnv("KNIGHTCODE_DISABLE_AUTO_UPDATE", "1");
		await updater.check();
		expect(states.map((state) => state.phase)).toEqual(["available"]);
		expect(mocks.managedUpdate).not.toHaveBeenCalled();
	});

	it.each([{ version: "bad" }, { version: "0.9.0" }, { version: "1.0.1", packageName: "renamed-package" }])(
		"keeps an explicit update path for unsafe targets: %j",
		async (release) => {
			mocks.check.mockResolvedValue(release);
			await updater.check();
			expect(mocks.managedUpdate).not.toHaveBeenCalled();
			expect(states[0]?.phase).toBe("available");
		},
	);

	it("allows a later attempt after a failed download", async () => {
		mocks.managedUpdate.mockRejectedValueOnce(new Error("offline"));
		await updater.check();
		expect(states[0]?.phase).toBe("failed");
		await updater.check();
		expect(states.at(-1)?.phase).toBe("ready");
	});

	it("reports a lock owned by another terminal without reporting success", async () => {
		mocks.managedUpdate.mockRejectedValue(Object.assign(new Error("locked"), { code: "ELOCKED" }));
		await updater.check();
		expect(states.map((state) => state.phase)).toEqual(["waiting"]);
	});

	it("prevents overlapping checks and stops checking after an update is ready", async () => {
		let finish: ((version: string) => void) | undefined;
		mocks.managedUpdate.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
		);
		const pending = updater.check();
		await Promise.resolve();
		await updater.check();
		expect(mocks.check).toHaveBeenCalledOnce();
		finish?.("1.0.1");
		await pending;
		await updater.check();
		expect(mocks.check).toHaveBeenCalledOnce();
	});

	it("cancels a managed download and suppresses notices after shutdown", async () => {
		mocks.managedUpdate.mockImplementation(
			(_root, _version, options) =>
				new Promise((_resolve, reject) => {
					options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
				}),
		);
		const pending = updater.check();
		await Promise.resolve();
		updater.stop();
		await pending;
		expect(states).toEqual([]);
	});

	function workerExits(code: number) {
		mocks.managedRoot.mockReturnValue(undefined);
		mocks.spawn.mockImplementation(() => {
			const child = new ChildProcess();
			vi.spyOn(child, "unref").mockImplementation(() => {});
			queueMicrotask(() => child.emit("close", code));
			return child;
		});
	}

	it("hands non-managed installs to a detached worker without blocking detection", async () => {
		workerExits(0);
		await updater.check();
		expect(mocks.spawn).toHaveBeenCalledWith(
			process.execPath,
			["update", "--self"],
			expect.objectContaining({
				detached: true,
				stdio: "ignore",
				env: expect.objectContaining({ KNIGHTCODE_SELF_UPDATE_VERSION: "1.0.1" }),
			}),
		);
		expect(states.map((state) => state.phase)).toEqual(["downloading", "ready"]);
	});

	it.each([
		[78, "available"],
		[75, "waiting"],
		[1, "failed"],
	])("maps worker exit code %i to %s", async (code, phase) => {
		workerExits(code);
		await updater.check();
		expect(states.map((state) => state.phase)).toEqual(["downloading", phase]);
	});

	it("never replaces a KNIGHTCODE_BIN_PATH override with a release", async () => {
		workerExits(0);
		vi.stubEnv("KNIGHTCODE_BIN_PATH", "/dev/build/knightcode");
		await updater.check();
		expect(mocks.spawn).not.toHaveBeenCalled();
		expect(states.map((state) => state.phase)).toEqual(["available"]);
	});

	it("reports a worker that cannot start as a failure instead of crashing", async () => {
		mocks.managedRoot.mockReturnValue(undefined);
		mocks.spawn.mockImplementation(() => {
			const child = new ChildProcess();
			vi.spyOn(child, "unref").mockImplementation(() => {});
			queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
			return child;
		});
		await updater.check();
		expect(states.at(-1)?.phase).toBe("failed");
	});

	it("checks periodically without keeping the process alive", async () => {
		vi.useFakeTimers();
		mocks.check.mockResolvedValue(undefined);
		updater.start();
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
		expect(mocks.check).toHaveBeenCalledTimes(2);
		updater.stop();
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
		expect(mocks.check).toHaveBeenCalledTimes(2);
	});
});
