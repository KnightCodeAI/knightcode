import { createHash } from "node:crypto";
import {
	accessSync,
	chmodSync,
	constants,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { PACKAGE_NAME } from "../config.ts";
import { trySelfUpdateLockSync, withSelfUpdateLock } from "./global-self-update.ts";
import { fetchWithRetry } from "./management-http.ts";
import { downloadFile, extractTarGzArchive, extractZipArchive } from "./tools-manager.ts";
import { runUpdateProcess } from "./update-process.ts";

const RELEASES_URL = "https://github.com/KnightCodeAI/knightcode/releases/download";
const RELEASE_TARGETS = new Set(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]);
/** Files an update replaced. Windows cannot delete a running executable, so they wait for the next start. */
const REPLACED_DIR = ".knightcode-update-old";
const STAGE_PREFIX = ".knightcode-update-stage-";
const RELEASE_BINARY = process.platform === "win32" ? "knightcode.exe" : "knightcode";

/** Why a downloaded binary at `binaryPath` cannot replace itself, or undefined when it can. */
export function getStandaloneUpdateUnavailableReason(binaryPath = process.execPath): string | undefined {
	if (!RELEASE_TARGETS.has(`${process.platform}-${process.arch}`)) {
		return `No prebuilt release for ${process.platform}-${process.arch}.`;
	}
	// Only the directory matters: the swap renames the binary aside, which works
	// on a read-only file on every platform.
	try {
		accessSync(dirname(binaryPath), constants.W_OK);
	} catch {
		return `${dirname(binaryPath)} is not writable.`;
	}
	return undefined;
}

/** Remove files replaced by an earlier update. Callers hold the self-update lock. */
function cleanupStandaloneUpdate(binaryPath = process.execPath): void {
	const dir = dirname(binaryPath);
	const replaced = join(dir, REPLACED_DIR);
	try {
		// A crash between moving a file aside and moving its replacement in leaves
		// the backup as the only copy. Put such files back before deleting backups.
		if (existsSync(replaced)) {
			for (const run of readdirSync(replaced).sort().reverse()) {
				for (const file of listFiles(join(replaced, run))) {
					const dest = join(dir, file === RELEASE_BINARY ? basename(binaryPath) : file);
					if (existsSync(dest)) continue;
					mkdirSync(dirname(dest), { recursive: true });
					renameSync(join(replaced, run, file), dest);
				}
			}
		}
		rmSync(replaced, { recursive: true, force: true });
		for (const entry of readdirSync(dir)) {
			if (entry.startsWith(STAGE_PREFIX)) rmSync(join(dir, entry), { recursive: true, force: true });
		}
	} catch {
		// A replaced executable is still running; the next start retries.
	}
}

/** Startup cleanup: on Windows the previous update could not delete the executable that was running. */
export function cleanupStandaloneInstall(binaryPath = process.execPath): void {
	if (existsSync(join(dirname(binaryPath), REPLACED_DIR)))
		trySelfUpdateLockSync(() => cleanupStandaloneUpdate(binaryPath));
}

function listFiles(root: string, dir = root): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? listFiles(root, join(dir, entry.name)) : [relative(root, join(dir, entry.name))],
	);
}

async function fetchChecksum(url: string, asset: string): Promise<string> {
	const response = await fetchWithRetry(url, undefined, { timeoutMs: 30_000 });
	if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
	for (const line of (await response.text()).split("\n")) {
		const [hash, name] = line.trim().split(/\s+/);
		if (name === asset && hash) return hash.toLowerCase();
	}
	throw new Error(`No checksum for ${asset}`);
}

/**
 * Replace a downloaded release in place: the GitHub archive for this platform is
 * checksum-verified, extracted next to the binary, smoke-tested, then swapped in
 * file by file. Renaming works on a running Windows executable where deleting
 * does not, which is why the old files are moved aside rather than overwritten.
 */
export function runStandaloneSelfUpdate(version: string, binaryPath = process.execPath): Promise<void> {
	return withSelfUpdateLock((lockLost) => replaceRelease(version, binaryPath, lockLost));
}

async function replaceRelease(version: string, binaryPath: string, lockLost: AbortSignal): Promise<void> {
	const unavailable = getStandaloneUpdateUnavailableReason(binaryPath);
	if (unavailable) throw new Error(unavailable);

	const dir = dirname(binaryPath);
	const releaseBinary = RELEASE_BINARY;
	const asset = `knightcode-${process.platform}-${process.arch}${process.platform === "win32" ? ".zip" : ".tar.gz"}`;
	const releaseUrl = `${RELEASES_URL}/${encodeURIComponent(`${PACKAGE_NAME}@${version}`)}`;

	cleanupStandaloneUpdate(binaryPath);
	// Stage beside the binary so every swap is a same-volume rename.
	const stage = mkdtempSync(join(dir, STAGE_PREFIX));
	try {
		const archive = join(stage, asset);
		const [expected] = await Promise.all([
			fetchChecksum(`${releaseUrl}/SHA256SUMS`, asset),
			downloadFile(`${releaseUrl}/${asset}`, archive),
		]);
		const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
		if (actual !== expected) throw new Error(`Checksum mismatch for ${asset}`);

		const extracted = join(stage, "release");
		mkdirSync(extracted);
		(asset.endsWith(".zip") ? extractZipArchive : extractTarGzArchive)(archive, extracted, asset);
		rmSync(archive, { force: true });

		const stagedBinary = join(extracted, releaseBinary);
		if (process.platform !== "win32") chmodSync(stagedBinary, 0o755);
		const installed = await runUpdateProcess(stagedBinary, ["--version"], {
			quiet: true,
			signal: AbortSignal.any([lockLost, AbortSignal.timeout(30_000)]),
		});
		if (installed !== version)
			throw new Error(`Downloaded ${asset} reports version ${installed}; expected ${version}.`);
		// The swap below is synchronous, so this is the last point where another
		// terminal's update could have taken over a lock this process let go stale.
		lockLost.throwIfAborted();

		// The binary goes last so an interrupted swap never runs new code against old assets.
		const files = listFiles(extracted).sort((a, b) => Number(a === releaseBinary) - Number(b === releaseBinary));
		const backup = join(dir, REPLACED_DIR, `${Date.now()}-${process.pid}`);
		const swapped: Array<{ dest: string; saved?: string }> = [];
		try {
			for (const file of files) {
				// A renamed binary (kc.exe) keeps its name; everything else keeps the archive layout.
				const dest = join(dir, file === releaseBinary ? basename(binaryPath) : file);
				mkdirSync(dirname(dest), { recursive: true });
				let saved: string | undefined;
				if (existsSync(dest)) {
					saved = join(backup, file);
					mkdirSync(dirname(saved), { recursive: true });
					renameSync(dest, saved);
				}
				swapped.push({ dest, saved });
				renameSync(join(extracted, file), dest);
			}
		} catch (error) {
			for (const { dest, saved } of swapped.reverse()) {
				try {
					if (saved) renameSync(saved, dest);
					else rmSync(dest, { force: true });
				} catch {
					// Keep restoring the rest; the backup directory still holds this file.
				}
			}
			throw error;
		}
	} finally {
		try {
			rmSync(stage, { recursive: true, force: true });
		} catch {
			// Cleaned up by the next update.
		}
	}
	cleanupStandaloneUpdate(binaryPath);
}
