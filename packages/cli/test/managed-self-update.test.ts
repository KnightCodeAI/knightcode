import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveManagedInstallRoot, runManagedSelfUpdate } from "../src/utils/managed-self-update.ts";
import type * as UpdateProcess from "../src/utils/update-process.ts";

const runProcess = vi.hoisted(() => vi.fn());
vi.mock("../src/utils/update-process.ts", async (original) => ({
	...(await original<typeof UpdateProcess>()),
	runUpdateProcess: runProcess,
}));

let root: string;
let verifiedVersion: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "knightcode-managed-update-"));
	mkdirSync(join(root, "releases", "1.0.0"), { recursive: true });
	writeFileSync(join(root, "current-version"), "1.0.0\n");
	writeFileSync(
		join(root, "managed-install.json"),
		JSON.stringify({ kind: "knightcode-managed-install", schemaVersion: 1, layout: "releases-v1" }),
	);
	vi.stubEnv("KNIGHTCODE_MANAGED_INSTALL_ROOT", root);
	vi.stubEnv("KNIGHTCODE_PACKAGE_DIR", join(root, "releases", "1.0.0"));
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => Response.json({})),
	);
	verifiedVersion = "1.0.1";
	runProcess.mockReset().mockImplementation(async (command: string) => (command === "npm" ? "" : verifiedVersion));
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe("managed update staging", () => {
	it("activates only after installation and verification, preserving the running release", async () => {
		const phases: string[] = [];
		await expect(
			runManagedSelfUpdate(root, "1.0.1", {
				quiet: true,
				onProgress: (phase) => {
					phases.push(phase);
					expect(readFileSync(join(root, "current-version"), "utf8")).toBe("1.0.0\n");
				},
			}),
		).resolves.toBe("1.0.1");
		expect(phases).toEqual(["downloading", "verifying"]);
		expect(readFileSync(join(root, "current-version"), "utf8")).toBe("1.0.1\n");
		expect(existsSync(join(root, "releases", "1.0.0"))).toBe(true);
		expect(readdirSync(join(root, "staging"))).toEqual([]);
	});

	it("keeps the launcher on the working release after failed verification", async () => {
		verifiedVersion = "bad";
		await expect(runManagedSelfUpdate(root, "1.0.1", { quiet: true })).rejects.toThrow("expected 1.0.1");
		expect(readFileSync(join(root, "current-version"), "utf8")).toBe("1.0.0\n");
		expect(existsSync(join(root, "releases", "1.0.1"))).toBe(false);
		expect(readdirSync(join(root, "staging"))).toEqual([]);
	});

	it("does not let an older session downgrade a release installed by another terminal", async () => {
		verifiedVersion = "1.0.2";
		writeFileSync(join(root, "current-version"), "1.0.2\n");
		mkdirSync(join(root, "releases", "1.0.2"));
		await expect(runManagedSelfUpdate(root, "1.0.1", { quiet: true })).resolves.toBe("1.0.2");
		expect(fetch).not.toHaveBeenCalled();
		expect(readFileSync(join(root, "current-version"), "utf8")).toBe("1.0.2\n");
	});

	it("reuses an already downloaded release", async () => {
		mkdirSync(join(root, "releases", "1.0.1"));
		await expect(runManagedSelfUpdate(root, "1.0.1", { quiet: true })).resolves.toBe("1.0.1");
		expect(fetch).not.toHaveBeenCalled();
		expect(readFileSync(join(root, "current-version"), "utf8")).toBe("1.0.1\n");
	});

	it("refuses concurrent staging through the manual updater's lock", async () => {
		const release = await lockfile.lock(join(root, "update"), { realpath: false });
		try {
			await expect(runManagedSelfUpdate(root, "1.0.1", { quiet: true })).rejects.toMatchObject({ code: "ELOCKED" });
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			await release();
		}
	});

	it("does not activate a staged release when shutdown cancels verification", async () => {
		const controller = new AbortController();
		await expect(
			runManagedSelfUpdate(root, "1.0.1", {
				quiet: true,
				signal: controller.signal,
				onProgress: (phase) => {
					if (phase === "verifying") controller.abort();
				},
			}),
		).rejects.toThrow();
		expect(readFileSync(join(root, "current-version"), "utf8")).toBe("1.0.0\n");
		expect(readdirSync(join(root, "staging"))).toEqual([]);
	});

	it("ignores inherited installer environment when running from a different installation", () => {
		vi.stubEnv("KNIGHTCODE_PACKAGE_DIR", join(root, "another-install"));
		expect(getActiveManagedInstallRoot()).toBeUndefined();
	});
});
