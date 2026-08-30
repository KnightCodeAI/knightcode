import type { ExecutionEnv } from "../types.ts";
import { getOrThrow } from "../types.ts";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";

const WINDOWS_CWD = /^[A-Za-z]:[\\/]/;
// Git Bash `/c/...`, WSL `/mnt/c/...` and Cygwin `/cygdrive/c/...` mounts of a Windows drive.
const POSIX_DRIVE_MOUNT = /^\/(?:mnt\/|cygdrive\/)?([A-Za-z])(?=\/|$)/;

/**
 * The bash tool runs Git Bash (or WSL/Cygwin/MSYS) on Windows, so its output carries POSIX-style
 * drive mounts. Passing one through unchanged makes `absolutePath` resolve `/c/Users/x` to
 * `C:\c\Users\x`, and read/edit/write then miss every file the shell just reported.
 */
function normalizeDriveMount(cwd: string, path: string): string {
	if (!WINDOWS_CWD.test(cwd)) return path;
	return path.replace(POSIX_DRIVE_MOUNT, (_match, drive: string) => `${drive.toUpperCase()}:`);
}

function normalizeToolPath(path: string): string {
	const normalized = path.replace(UNICODE_SPACES, " ");
	return normalized.startsWith("@") ? normalized.slice(1) : normalized;
}

export async function resolveToolPath(env: ExecutionEnv, path: string, signal?: AbortSignal): Promise<string> {
	return getOrThrow(await env.absolutePath(normalizeDriveMount(env.cwd, normalizeToolPath(path)), signal));
}

export async function resolveReadToolPath(env: ExecutionEnv, path: string, signal?: AbortSignal): Promise<string> {
	const resolved = await resolveToolPath(env, path, signal);
	const variants = [
		resolved,
		resolved.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`),
		resolved.normalize("NFD"),
		resolved.replace(/'/g, "\u2019"),
		resolved.normalize("NFD").replace(/'/g, "\u2019"),
	];

	for (const variant of new Set(variants)) {
		if (getOrThrow(await env.exists(variant, signal))) return variant;
	}
	return resolved;
}
