import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import lockfile from "proper-lockfile";
import { getAgentDir } from "../../config.ts";

export interface MicroSessionLocation {
	id: string;
	path: string;
	cwd: string;
	created: boolean;
	release(): Promise<void>;
	/** Release the lock and, for a session this call created, remove its directory. */
	discard(): Promise<void>;
}

/** A session has a transcript once storage has opened it; an abandoned launch leaves none. */
async function hasTranscript(path: string): Promise<boolean> {
	const file = await stat(join(path, "main.jsonl")).catch(() => undefined);
	return file !== undefined && file.size > 0;
}

function cwdKey(cwd: string): string {
	return createHash("sha256").update(cwd).digest("hex").slice(0, 24);
}

/**
 * Select a new session, or the newest session for this cwd, without opening any JSONL logs.
 * `sessionsDir` overrides where sessions live; it defaults to the agent directory.
 */
export async function selectSession(
	cwdInput: string,
	continueSession: boolean,
	sessionsDir?: string,
): Promise<MicroSessionLocation> {
	const cwd = await realpath(resolve(cwdInput));
	const root = join(sessionsDir ?? join(getAgentDir(), "experimental", "micro-sessions"), cwdKey(cwd));
	await mkdir(root, { recursive: true });

	let path: string;
	let created = false;
	if (continueSession) {
		const entries = await readdir(root, { withFileTypes: true });
		const candidates = entries
			.filter((entry) => entry.isDirectory() && /^\d{13}-[0-9a-f-]{36}$/u.test(entry.name))
			.map((entry) => entry.name)
			.sort()
			.reverse();
		// A launch that failed before storage opened leaves an empty directory behind. Continuing
		// into one would show an empty conversation instead of the session the user meant.
		let newest: string | undefined;
		for (const candidate of candidates) {
			if (await hasTranscript(join(root, candidate))) {
				newest = candidate;
				break;
			}
		}
		if (!newest) throw new Error(`No micro session exists for ${cwd}`);
		path = join(root, newest);
	} else {
		path = join(root, `${String(Date.now()).padStart(13, "0")}-${randomUUID()}`);
		await mkdir(path);
		created = true;
	}

	let release: () => Promise<void>;
	try {
		release = await lockfile.lock(path, { realpath: false, retries: 0 });
	} catch (error) {
		throw new Error(`Micro session is already open: ${path}`, { cause: error });
	}
	const sessionPath = path;
	return {
		id: basename(sessionPath),
		path: sessionPath,
		cwd,
		created,
		release,
		async discard() {
			await release().catch(() => {});
			// Only a directory this call made, and only while it holds nothing, is removed.
			if (created && !(await hasTranscript(sessionPath))) {
				await rm(sessionPath, { recursive: true, force: true }).catch(() => {});
			}
		},
	};
}
