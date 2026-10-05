import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as UpdateProcess from "../src/utils/update-process.ts";
import {
	cleanupStandaloneInstall,
	getStandaloneUpdateUnavailableReason,
	runStandaloneSelfUpdate,
} from "../src/utils/standalone-self-update.ts";

const runProcess = vi.hoisted(() => vi.fn());
vi.mock("../src/utils/update-process.ts", async (original) => ({
	...(await original<typeof UpdateProcess>()),
	runUpdateProcess: runProcess,
}));

const exe = process.platform === "win32" ? "knightcode.exe" : "knightcode";
const asset = `knightcode-${process.platform}-${process.arch}${process.platform === "win32" ? ".zip" : ".tar.gz"}`;

let root: string;
let install: string;
let archive: Buffer;
let checksum: string;

function buildRelease(files: Record<string, string>): void {
	const src = join(root, "release-src");
	rmSync(src, { recursive: true, force: true });
	for (const [file, content] of Object.entries(files)) {
		mkdirSync(join(src, file, ".."), { recursive: true });
		writeFileSync(join(src, file), content);
	}
	const out = join(root, asset);
	rmSync(out, { force: true });
	// Same layout as the publish workflow: the archive root is the bin/ directory.
	const result =
		process.platform === "win32"
			? spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), [
					"--format=zip",
					"-cf",
					out,
					"-C",
					src,
					".",
				])
			: spawnSync("tar", ["-czf", out, "-C", src, "."]);
	expect(result.status, result.stderr?.toString()).toBe(0);
	archive = readFileSync(out);
	checksum = createHash("sha256").update(archive).digest("hex");
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "knightcode-standalone-update-"));
	install = join(root, "install");
	mkdirSync(join(install, "theme"), { recursive: true });
	writeFileSync(join(install, exe), "old binary");
	writeFileSync(join(install, "theme", "dark.json"), "old theme");
	writeFileSync(join(install, "unrelated.txt"), "user file");
	vi.stubEnv("KNIGHTCODE_CODING_AGENT_DIR", join(root, "agent"));
	buildRelease({ [exe]: "new binary", "theme/dark.json": "new theme", "docs/README.md": "new docs" });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			expect(url).toContain(encodeURIComponent("@knightcodeai/cli@1.0.1"));
			return url.endsWith("/SHA256SUMS")
				? new Response(`${"0".repeat(64)}  other.zip\n${checksum}  ${asset}\n`)
				: new Response(archive);
		}),
	);
	runProcess.mockReset().mockResolvedValue("1.0.1");
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	rmSync(root, { recursive: true, force: true });
});

const read = (file: string) => readFileSync(join(install, file), "utf8");

describe("standalone binary updates", () => {
	it("swaps in the verified release and leaves unrelated files alone", async () => {
		await runStandaloneSelfUpdate("1.0.1", join(install, exe));
		expect(read(exe)).toBe("new binary");
		expect(read("theme/dark.json")).toBe("new theme");
		expect(read("docs/README.md")).toBe("new docs");
		expect(read("unrelated.txt")).toBe("user file");
		// Staging and the replaced files are gone once nothing runs them.
		expect(readdirSync(install).filter((entry) => entry.startsWith(".knightcode-update"))).toEqual([]);
		expect(runProcess).toHaveBeenCalledWith(expect.stringContaining(exe), ["--version"], expect.anything());
	});

	it("keeps the name of a renamed binary", async () => {
		const renamed = process.platform === "win32" ? "kc.exe" : "kc";
		writeFileSync(join(install, renamed), "old binary");
		rmSync(join(install, exe));
		await runStandaloneSelfUpdate("1.0.1", join(install, renamed));
		expect(read(renamed)).toBe("new binary");
		expect(existsSync(join(install, exe))).toBe(false);
	});

	it("changes nothing when the archive does not match its checksum", async () => {
		checksum = "f".repeat(64);
		await expect(runStandaloneSelfUpdate("1.0.1", join(install, exe))).rejects.toThrow("Checksum mismatch");
		expect(read(exe)).toBe("old binary");
		expect(runProcess).not.toHaveBeenCalled();
	});

	it("changes nothing when the downloaded binary reports another version", async () => {
		runProcess.mockResolvedValue("1.0.0");
		await expect(runStandaloneSelfUpdate("1.0.1", join(install, exe))).rejects.toThrow("expected 1.0.1");
		expect(read(exe)).toBe("old binary");
		expect(read("theme/dark.json")).toBe("old theme");
	});

	it("restores every swapped file when the swap fails part way", async () => {
		// `zzz` is a file in the old install but a directory in the release, so its
		// swap fails after the earlier entries were already replaced.
		writeFileSync(join(install, "zzz"), "old file");
		buildRelease({ [exe]: "new binary", "theme/dark.json": "new theme", "zzz/inner.txt": "new" });
		await expect(runStandaloneSelfUpdate("1.0.1", join(install, exe))).rejects.toThrow();
		expect(read(exe)).toBe("old binary");
		expect(read("theme/dark.json")).toBe("old theme");
		expect(read("zzz")).toBe("old file");
	});

	it("stops before swapping when the update lock is lost", async () => {
		const realLock = lockfile.lock.bind(lockfile);
		let compromise: ((error: Error) => void) | undefined;
		const spy = vi.spyOn(lockfile, "lock").mockImplementation((file, options) => {
			compromise = options?.onCompromised;
			return realLock(file, options);
		});
		try {
			// The lock goes stale while the smoke test runs; another terminal may own it now.
			runProcess.mockImplementation(async () => {
				compromise?.(new Error("lock compromised"));
				return "1.0.1";
			});
			await expect(runStandaloneSelfUpdate("1.0.1", join(install, exe))).rejects.toThrow("lock compromised");
			expect(read(exe)).toBe("old binary");
			expect(read("theme/dark.json")).toBe("old theme");
		} finally {
			spy.mockRestore();
		}
	});

	it("updates a read-only binary in a writable directory", async () => {
		chmodSync(join(install, exe), 0o555);
		expect(getStandaloneUpdateUnavailableReason(join(install, exe))).toBeUndefined();
		await runStandaloneSelfUpdate("1.0.1", join(install, exe));
		expect(read(exe)).toBe("new binary");
	});

	it("restores files a crashed swap left only in the backup before deleting it", () => {
		// The crash happened after theme/dark.json moved aside and before its
		// replacement moved in; the binary had not been touched yet.
		const backup = join(install, ".knightcode-update-old", "1-1");
		mkdirSync(join(backup, "theme"), { recursive: true });
		renameSync(join(install, "theme", "dark.json"), join(backup, "theme", "dark.json"));
		writeFileSync(join(backup, exe), "replaced binary");
		cleanupStandaloneInstall(join(install, exe));
		expect(read("theme/dark.json")).toBe("old theme");
		expect(read(exe)).toBe("old binary");
		expect(existsSync(join(install, ".knightcode-update-old"))).toBe(false);
	});

	it("waits for an update another terminal is running", async () => {
		mkdirSync(join(root, "agent"), { recursive: true });
		const release = await lockfile.lock(join(root, "agent", "self-update"), { realpath: false });
		try {
			await expect(runStandaloneSelfUpdate("1.0.1", join(install, exe))).rejects.toMatchObject({ code: "ELOCKED" });
			expect(read(exe)).toBe("old binary");
		} finally {
			await release();
		}
	});
});
