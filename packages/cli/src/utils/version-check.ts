import { compare, valid } from "semver";
import { fetchWithRetry } from "./management-http.ts";
import { getKnightcodeUserAgent } from "./user-agent.ts";

const LATEST_VERSION_URL = "https://knightcode.raghavseth.in/api/latest-version";
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestPiRelease {
	version: string;
	packageName?: string;
	note?: string;
}

/** Depth bound for the cause walk below; also what stops a self-referential chain. */
const MAX_CAUSE_DEPTH = 5;

/** Include useful errno details hidden behind Node's generic "fetch failed" error. */
export function formatVersionCheckError(error: unknown): string {
	const rootMessage = error instanceof Error && error.message ? error.message : String(error);

	// The actionable detail (DNS, TLS, timeout) sits somewhere below the generic
	// top-level message: Node nests causes arbitrarily deep and wraps multi-address
	// attempts in an AggregateError, so walk both branches rather than one level.
	// Everything is matched structurally - undici hands back plain objects and
	// cross-realm errors that carry an errno without being `instanceof Error`.
	const codes = new Set<string>();
	let deepest: { depth: number; message: string } | undefined;
	const visit = (value: unknown, depth: number): void => {
		if (depth > MAX_CAUSE_DEPTH || typeof value !== "object" || value === null) return;
		const candidate = value as { code?: unknown; message?: unknown; cause?: unknown; errors?: unknown };
		if (typeof candidate.code === "string") {
			codes.add(candidate.code);
		}
		// Deepest wins: the outer layers are the generic wrappers ("fetch failed",
		// "Client network socket disconnected") and the specific detail is at the bottom.
		if (typeof candidate.message === "string" && candidate.message && (!deepest || depth > deepest.depth)) {
			deepest = { depth, message: candidate.message };
		}
		if (Array.isArray(candidate.errors)) {
			for (const entry of candidate.errors) {
				visit(entry, depth + 1);
			}
		}
		visit(candidate.cause, depth + 1);
	};
	visit(error instanceof Error ? error.cause : undefined, 1);

	if (codes.size > 0) return `${rootMessage} (${[...codes].join(", ")})`;
	return deepest ? `${rootMessage} (cause: ${deepest.message})` : rootMessage;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestPiRelease(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<LatestPiRelease | undefined> {
	if (process.env.KNIGHTCODE_OFFLINE) return undefined;

	const response = await fetchWithRetry(
		LATEST_VERSION_URL,
		{
			headers: {
				"User-Agent": getKnightcodeUserAgent(currentVersion),
				accept: "application/json",
			},
		},
		{
			maxRetries: options.retry ? 2 : 0,
			timeoutMs: options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS,
		},
	);
	if (!response.ok) return undefined;

	const data = (await response.json()) as {
		packageName?: unknown;
		version?: unknown;
		note?: unknown;
	};
	if (typeof data.version !== "string" || !data.version.trim()) {
		return undefined;
	}
	const packageName =
		typeof data.packageName === "string" && data.packageName.trim() ? data.packageName.trim() : undefined;
	const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : undefined;
	return {
		version: data.version.trim(),
		packageName,
		...(note ? { note } : {}),
	};
}

export async function getLatestPiVersion(
	currentVersion: string,
	options: { timeoutMs?: number; retry?: boolean } = {},
): Promise<string | undefined> {
	return (await getLatestPiRelease(currentVersion, options))?.version;
}

export async function checkForNewPiVersion(currentVersion: string): Promise<LatestPiRelease | undefined> {
	if (process.env.KNIGHTCODE_SKIP_VERSION_CHECK) return undefined;

	try {
		const latestRelease = await getLatestPiRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
