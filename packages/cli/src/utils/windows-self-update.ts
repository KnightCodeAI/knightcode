import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, resolve, toNamespacedPath } from "node:path";

const QUARANTINE_DIR_NAME = ".knightcode-native-quarantine";

function normalizePath(path: string): string {
	return toNamespacedPath(resolve(path));
}

function getQuarantineRoot(packageDir: string): string | undefined {
	let current = resolve(packageDir);
	while (true) {
		if (basename(current).toLowerCase() === "node_modules") {
			return join(current, QUARANTINE_DIR_NAME);
		}
		const parent = dirname(current);
		if (parent === current) {
			return undefined;
		}
		current = parent;
	}
}

/**
 * Windows refuses to delete or overwrite a running executable or a loaded native
 * addon, and any open KnightCode terminal (not just this process) may hold one.
 * Renaming still works, so every native image in the package is moved aside.
 */
function getNativeImagesInPackageDir(packageDir: string): string[] {
	return readdirSync(packageDir, { recursive: true, encoding: "utf8" })
		.filter((file) => /\.(exe|node|dll)$/i.test(file))
		.map((file) => join(packageDir, file));
}

export function cleanupWindowsSelfUpdateQuarantine(packageDir: string): void {
	const quarantineRoot = getQuarantineRoot(packageDir);
	if (!quarantineRoot) {
		return;
	}
	try {
		rmSync(quarantineRoot, { recursive: true, force: true });
	} catch {
		// A previous KnightCode process may still be exiting and holding a native addon.
	}
}

export function quarantineWindowsNativeDependencies(packageDir: string): void {
	const resolvedPackageDir = normalizePath(packageDir);
	const quarantineRoot = getQuarantineRoot(resolvedPackageDir);
	if (!quarantineRoot) {
		return;
	}

	const loadedFiles = getNativeImagesInPackageDir(resolvedPackageDir);
	if (loadedFiles.length === 0) {
		return;
	}

	const quarantineRunDir = join(quarantineRoot, `${Date.now()}-${process.pid}-${randomUUID()}`);
	for (const loadedFile of loadedFiles) {
		if (!existsSync(loadedFile)) {
			continue;
		}
		const quarantinePath = join(quarantineRunDir, relative(resolvedPackageDir, loadedFile));
		mkdirSync(dirname(quarantinePath), { recursive: true });
		renameSync(loadedFile, quarantinePath);
		copyFileSync(quarantinePath, loadedFile);
	}
}
