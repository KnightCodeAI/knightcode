import { createHash } from "node:crypto";
import {
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../config.ts";

/** One user turn: the pre-edit copy of every file the turn touched (`null` = did not exist yet). */
type Checkpoint = { files: Record<string, string | null>; shellRan?: true; failed?: true };
type Index = { version: 1; checkpoints: Record<string, Checkpoint> };

export type Abandoned = { files: Map<string, string | null>; shellRan: boolean; failed: boolean };

// Byte-compare before restoring only up to this size; larger files are copied unconditionally.
const COMPARE_LIMIT = 4 * 1024 * 1024;

function historyRoot(): string {
	return join(getAgentDir(), "file-history");
}

// Windows paths are case-insensitive, so the same file must not get two keys.
function pathKey(absPath: string): string {
	return process.platform === "win32" ? absPath.toLowerCase() : absPath;
}

function sameContent(a: string, b: string): boolean {
	if (!existsSync(a) || !existsSync(b)) return false;
	const size = statSync(a).size;
	if (size !== statSync(b).size || size > COMPARE_LIMIT) return false;
	return readFileSync(a).equals(readFileSync(b));
}

/**
 * Copy-on-write backups for one session, keyed by the user message that was current when the
 * edit happened. Everything lives under `<agentDir>/file-history/<sessionId>/` so a
 * re-instantiated extension (fork, resume) finds the same state.
 */
export class FileHistory {
	private readonly dir: string;
	private index: Index | undefined;

	private constructor(dir: string) {
		this.dir = dir;
	}

	static forSession(sessionId: string): FileHistory {
		return new FileHistory(join(historyRoot(), sessionId));
	}

	private load(): Index {
		if (this.index) return this.index;
		try {
			this.index = JSON.parse(readFileSync(join(this.dir, "index.json"), "utf8")) as Index;
		} catch {
			this.index = { version: 1, checkpoints: {} };
		}
		return this.index;
	}

	private save(): void {
		mkdirSync(this.dir, { recursive: true });
		const tmp = join(this.dir, `index.json.${process.pid}.tmp`);
		writeFileSync(tmp, JSON.stringify(this.index));
		renameSync(tmp, join(this.dir, "index.json"));
	}

	private checkpoint(entryId: string): Checkpoint {
		const index = this.load();
		return (index.checkpoints[entryId] ??= { files: {} });
	}

	/** Back up `absPath` before its first write in this checkpoint; later calls are no-ops. */
	record(entryId: string, absPath: string): void {
		const key = pathKey(absPath);
		const checkpoint = this.checkpoint(entryId);
		if (key in checkpoint.files) return;
		if (!existsSync(key)) {
			checkpoint.files[key] = null;
		} else {
			const name = `${createHash("sha256").update(key).digest("hex").slice(0, 16)}@${entryId}`;
			try {
				mkdirSync(this.dir, { recursive: true });
				copyFileSync(key, join(this.dir, name));
				checkpoint.files[key] = name;
			} catch {
				checkpoint.failed = true;
			}
		}
		this.save();
	}

	markShell(entryId: string): void {
		this.checkpoint(entryId).shellRan = true;
		this.save();
	}

	/** Files to restore when `entryIds` (chronological) are abandoned: the earliest backup wins. */
	abandoned(entryIds: string[]): Abandoned {
		const index = this.load();
		const result: Abandoned = { files: new Map(), shellRan: false, failed: false };
		for (const id of entryIds) {
			const checkpoint = index.checkpoints[id];
			if (!checkpoint) continue;
			for (const [file, backup] of Object.entries(checkpoint.files)) {
				if (!result.files.has(file)) result.files.set(file, backup);
			}
			result.shellRan ||= checkpoint.shellRan === true;
			result.failed ||= checkpoint.failed === true;
		}
		return result;
	}

	restore(files: Map<string, string | null>): { restored: number; failed: string[] } {
		let restored = 0;
		const failed: string[] = [];
		for (const [file, backup] of files) {
			try {
				if (backup === null) {
					if (!existsSync(file)) continue;
					rmSync(file, { force: true });
				} else {
					const source = join(this.dir, backup);
					if (sameContent(source, file)) continue;
					mkdirSync(dirname(file), { recursive: true });
					copyFileSync(source, file);
				}
				restored++;
			} catch {
				failed.push(file);
			}
		}
		return { restored, failed };
	}

	/** Carry this session's backups over to a forked session (entry ids are preserved by fork). */
	copyTo(sessionId: string): void {
		if (!existsSync(join(this.dir, "index.json"))) return;
		cpSync(this.dir, join(historyRoot(), sessionId), { recursive: true });
	}

	static prune(days: number): void {
		const root = historyRoot();
		if (!existsSync(root)) return;
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		for (const name of readdirSync(root)) {
			const dir = join(root, name);
			try {
				if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true });
			} catch {
				// A directory that vanished or cannot be read is not worth failing startup over.
			}
		}
	}
}
