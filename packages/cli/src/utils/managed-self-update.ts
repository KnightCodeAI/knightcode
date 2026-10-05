import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { APP_NAME, getPackageDir, VERSION } from "../config.ts";
import { canonicalizePath, getCwdRelativePath } from "./paths.ts";
import { getKnightcodeUserAgent } from "./user-agent.ts";
import { fetchWithRetry } from "./management-http.ts";
import { comparePackageVersions } from "./version-check.ts";
import { runUpdateProcess, UPDATE_STEP_TIMEOUT_MS } from "./update-process.ts";

const DEFAULT_INSTALLER_API_BASE = "https://knightcode.dev/api/installer/releases";
const MANAGED_INSTALL_MARKER = "managed-install.json";
const MANAGED_RELEASE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function getActiveManagedInstallRoot(): string | undefined {
	const configuredRoot = process.env.KNIGHTCODE_MANAGED_INSTALL_ROOT?.trim();
	if (!configuredRoot) return undefined;

	const managedRoot = resolve(configuredRoot);
	const releasesDir = canonicalizePath(join(managedRoot, "releases"));
	// The launcher environment is inherited by child processes. Do not classify a
	// source checkout or another KnightCode installation launched from managed KnightCode as managed.
	if (getCwdRelativePath(canonicalizePath(getPackageDir()), releasesDir) === undefined) return undefined;

	const markerPath = join(managedRoot, MANAGED_INSTALL_MARKER);
	try {
		const marker = JSON.parse(readFileSync(markerPath, "utf8")) as {
			kind?: unknown;
			layout?: unknown;
			schemaVersion?: unknown;
		};
		if (marker.kind !== "knightcode-managed-install" || marker.schemaVersion !== 1 || marker.layout !== "releases-v1") {
			throw new Error();
		}
	} catch {
		throw new Error(`Managed install marker is missing or invalid: ${markerPath}`);
	}

	return managedRoot;
}

async function fetchInstallerArtifact(url: string, label: string, signal?: AbortSignal): Promise<string> {
	const response = await fetchWithRetry(
		url,
		{
			headers: { "User-Agent": getKnightcodeUserAgent(VERSION) },
			signal,
		},
		{ timeoutMs: 30_000 },
	);
	if (!response.ok) {
		throw new Error(`Could not download managed installer ${label} from ${url}: HTTP ${response.status}`);
	}
	return await response.text();
}

async function runManagedNpmCi(stageDir: string, options: { quiet?: boolean; signal?: AbortSignal }): Promise<void> {
	const args = [
		"ci",
		"--ignore-scripts",
		"--min-release-age=0",
		"--omit=dev",
		"--include=optional",
		"--no-fund",
		"--no-audit",
		"--loglevel=error",
		"--progress=false",
	];
	const timeout = AbortSignal.timeout(UPDATE_STEP_TIMEOUT_MS);
	await runUpdateProcess("npm", args, {
		...options,
		cwd: stageDir,
		signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
	});
}

async function verifyManagedRelease(releaseDir: string, expectedVersion: string, signal?: AbortSignal): Promise<void> {
	const binPath = join(releaseDir, "node_modules", ".bin", process.platform === "win32" ? `${APP_NAME}.cmd` : APP_NAME);
	const installedVersion = await runUpdateProcess(binPath, ["--version"], {
		quiet: true,
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
	});
	if (installedVersion !== expectedVersion) {
		throw new Error(`Managed KnightCode smoke test returned version ${installedVersion}; expected ${expectedVersion}.`);
	}
}

function activateManagedRelease(managedRoot: string, version: string): void {
	const currentPath = join(managedRoot, "current-version");
	const temporaryPath = join(managedRoot, `current-version.tmp.${process.pid}-${Date.now()}`);
	try {
		writeFileSync(temporaryPath, `${version}\n`);
		renameSync(temporaryPath, currentPath);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

function cleanupManagedStaging(managedRoot: string): void {
	const stagingRoot = join(managedRoot, "staging");
	try {
		for (const entry of readdirSync(stagingRoot)) {
			if (entry.startsWith("update-")) {
				rmSync(join(stagingRoot, entry), { force: true, recursive: true });
			}
		}
	} catch {
		// The staging directory does not exist yet or is not writable.
	}
}

export function cleanupManagedInstall(): void {
	let managedRoot: string | undefined;
	try {
		managedRoot = getActiveManagedInstallRoot();
	} catch {
		return;
	}
	if (!managedRoot) return;

	try {
		const releaseLock = lockfile.lockSync(join(managedRoot, "update"), { realpath: false });
		try {
			cleanupManagedStaging(managedRoot);
		} finally {
			releaseLock();
		}
	} catch {
		// A live update owns the staging directory, or cleanup is unavailable.
	}
}

export async function runManagedSelfUpdate(
	managedRoot: string,
	version: string,
	options: { quiet?: boolean; signal?: AbortSignal; onProgress?: (phase: "downloading" | "verifying") => void } = {},
): Promise<string> {
	if (!MANAGED_RELEASE_VERSION_RE.test(version)) {
		throw new Error(`Invalid managed release version: ${version}`);
	}
	const operation = new AbortController();
	options = {
		...options,
		signal: options.signal ? AbortSignal.any([options.signal, operation.signal]) : operation.signal,
	};

	let releaseLock: () => Promise<void>;
	try {
		releaseLock = await lockfile.lock(join(managedRoot, "update"), {
			realpath: false,
			onCompromised: (error) => operation.abort(error),
		});
	} catch (error: unknown) {
		if (error instanceof Error && "code" in error && error.code === "ELOCKED") {
			throw Object.assign(new Error("Another managed KnightCode update is already running."), { code: "ELOCKED" });
		}
		throw error;
	}

	let stageDir: string | undefined;
	try {
		options.signal?.throwIfAborted();
		// An older open session must never move the launcher back from a newer release.
		const selected = readFileSync(join(managedRoot, "current-version"), "utf8").trim();
		if ((comparePackageVersions(selected, version) ?? -1) >= 0) {
			options.onProgress?.("verifying");
			await verifyManagedRelease(join(managedRoot, "releases", selected), selected, options.signal);
			options.signal?.throwIfAborted();
			return selected;
		}
		cleanupManagedStaging(managedRoot);
		const installerApiBase = (process.env.KNIGHTCODE_INSTALLER_API_BASE?.trim() || DEFAULT_INSTALLER_API_BASE).replace(
			/\/+$/,
			"",
		);
		const releaseUrl = `${installerApiBase}/${encodeURIComponent(version)}`;
		const stagingRoot = join(managedRoot, "staging");
		const releasesRoot = join(managedRoot, "releases");
		mkdirSync(releasesRoot, { recursive: true });
		const releaseDir = join(releasesRoot, version);
		if (existsSync(releaseDir)) {
			options.onProgress?.("verifying");
			await verifyManagedRelease(releaseDir, version, options.signal);
			options.signal?.throwIfAborted();
			activateManagedRelease(managedRoot, version);
			return version;
		}

		mkdirSync(stagingRoot, { recursive: true });
		stageDir = mkdtempSync(join(stagingRoot, "update-"));
		options.onProgress?.("downloading");
		const [packageJsonContent, packageLockContent] = await Promise.all([
			fetchInstallerArtifact(`${releaseUrl}/package.json`, "package.json", options.signal),
			fetchInstallerArtifact(`${releaseUrl}/package-lock.json`, "package-lock.json", options.signal),
		]);
		writeFileSync(join(stageDir, "package.json"), packageJsonContent);
		writeFileSync(join(stageDir, "package-lock.json"), packageLockContent);

		await runManagedNpmCi(stageDir, options);
		options.onProgress?.("verifying");
		await verifyManagedRelease(stageDir, version, options.signal);
		options.signal?.throwIfAborted();
		renameSync(stageDir, releaseDir);
		activateManagedRelease(managedRoot, version);
		return version;
	} finally {
		try {
			if (stageDir) rmSync(stageDir, { force: true, recursive: true });
		} catch {
			// Windows may still hold files from a cancelled npm process. Startup
			// cleanup can retry; the running release and version pointer are intact.
		} finally {
			await releaseLock();
		}
	}
}
