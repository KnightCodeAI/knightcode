/**
 * Cross-process lock on a live session file (app server §5.5).
 *
 * Two processes appending to one JSONL file interleave entries and corrupt
 * the tree. The desktop app's app server and a terminal CLI are two such
 * processes. The lock is a `proper-lockfile` directory beside the file,
 * refreshed while held so a crashed holder's lock goes stale, plus an owner
 * token file that writers check synchronously: a stalled event loop can miss
 * a takeover until its next refresh, and must not write or release meanwhile.
 * proper-lockfile's own removal and refresh (its unlock, its exit handler, its
 * refresh timer) go through an `fs` that checks the same token.
 *
 * Within one process the lock is shared and counted: the runtime's fork path
 * opens a second manager on the live file for a moment. Each acquisition
 * gets its own handle, bound to the underlying lock it counted on.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import lockfile from "proper-lockfile";

export interface LockTiming {
	staleMs: number;
	updateMs: number;
}

let defaultTiming: LockTiming = { staleMs: 30_000, updateMs: 10_000 };

/** Tests shorten the timing so compromise and recovery happen in seconds. */
export function configureSessionLocks(timing: LockTiming): void {
	defaultTiming = timing;
}

export class SessionLockedError extends Error {
	readonly sessionFile: string;

	constructor(sessionFile: string, owner = "another KnightCode process") {
		super(`Session is open in ${owner}: ${sessionFile}`);
		this.name = "SessionLockedError";
		this.sessionFile = sessionFile;
	}
}

export interface SessionLock {
	/** Checked against the owner token on every read: true once another process holds the file. */
	readonly lost: boolean;
	/** Whether this lock is for `sessionFile` (a canonical path). A manager writes only the file its lock covers. */
	covers(sessionFile: string): boolean;
	/** Idempotent. Never touches a newer acquisition, or another process's lock. */
	release(): void;
}

/**
 * The transcript has more than one name (a hard link). Ownership by path cannot cover both names, so it is
 * refused. An archive move interrupted between its link and its unlink leaves exactly this (§5.8).
 */
export class SessionHardLinkedError extends Error {
	readonly sessionFile: string;

	constructor(sessionFile: string) {
		super(`Session file has more than one name (hard link); resolve the duplicate before opening it: ${sessionFile}`);
		this.name = "SessionHardLinkedError";
		this.sessionFile = sessionFile;
	}
}

interface Held {
	count: number;
	exclusive: boolean;
	lost: boolean;
	token: string;
	unlock: () => void;
}

const held = new Map<string, Held>();

/** Existing files resolve through aliases; a new file resolves through its existing parent. */
export function canonicalSessionPath(sessionFile: string): string {
	const absolute = resolve(sessionFile);
	try {
		return fs.realpathSync.native(absolute);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		// A dangling symlink is not a new destination.
		try {
			if (fs.lstatSync(absolute).isSymbolicLink()) throw error;
		} catch (statError) {
			if (statError === error || (statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
		}
		return join(fs.realpathSync.native(dirname(absolute)), basename(absolute));
	}
}

/** Canonical Windows map keys compare case-insensitively; disk paths keep their actual spelling. */
function keyOf(sessionFile: string): string {
	return process.platform === "win32" ? sessionFile.toLowerCase() : sessionFile;
}

const ownerFile = (sessionFile: string) => `${sessionFile}.lock-owner`;

function tokenOnDisk(sessionFile: string): string | undefined {
	try {
		return fs.readFileSync(ownerFile(sessionFile), "utf8");
	} catch {
		return undefined;
	}
}

/**
 * The fs proper-lockfile uses for one acquisition. Once `owns()` says another holder has the file,
 * removing the lock directory does nothing and refreshing it fails as if it were gone (§5.5).
 */
function guardedFs(owns: () => boolean): typeof fs {
	return {
		...fs,
		rmdirSync: ((path: fs.PathLike, options?: fs.RmDirOptions) => {
			if (owns()) fs.rmdirSync(path, options);
		}) as typeof fs.rmdirSync,
		utimesSync: ((path: fs.PathLike, atime: fs.TimeLike, mtime: fs.TimeLike) => {
			if (!owns()) throw Object.assign(new Error(`lock taken by another holder: ${String(path)}`), { code: "ENOENT" });
			fs.utimesSync(path, atime, mtime);
		}) as typeof fs.utimesSync,
	};
}

/**
 * Take the lock and stamp it with a fresh token. Does not create the session directory: a lock whose
 * directory was deleted is lost, not silently recreated.
 */
function take(sessionFile: string, timing: LockTiming, entry: Held, onCompromised: () => void): void {
	const token = `${process.pid}-${randomUUID()}`;
	// Off while lockSync runs: removing a stale lock and probing mtime precision come before our token exists.
	let armed = false;
	const owns = () => !armed || tokenOnDisk(sessionFile) === token;
	try {
		entry.unlock = lockfile.lockSync(sessionFile, {
			realpath: false,
			stale: timing.staleMs,
			update: timing.updateMs,
			onCompromised,
			fs: guardedFs(owns),
		});
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ELOCKED") throw new SessionLockedError(sessionFile);
		throw error;
	}
	try {
		fs.writeFileSync(ownerFile(sessionFile), token);
	} catch (error) {
		// Without a token nothing can prove ownership, and the lock would stay held (and refreshed) by an
		// acquisition that failed. Give it back before failing; the guard is still off, so this removes it.
		try {
			entry.unlock();
		} catch {
			// Already gone.
		}
		throw error;
	}
	entry.token = token;
	armed = true;
}

function createHeld(sessionFile: string, key: string, timing: LockTiming): Held {
	const entry: Held = { count: 0, exclusive: false, lost: false, token: "", unlock: () => {} };
	// proper-lockfile gives the lock up when a refresh fails: its directory was deleted (ENOENT), another
	// process replaced it (the mtime is not ours), or the guarded fs refused (the token is not ours). A
	// refresh that merely runs late, with the mtime still ours, is renewed by proper-lockfile itself. The
	// default handler throws from a timer and kills the process. Only a deleted lock directory, which leaves
	// our token in place, is taken again; a changed or missing token means another holder may have written
	// the file meanwhile, so our in-memory transcript is stale.
	const onCompromised = () => {
		if (entry.count === 0 || entry.lost) return;
		try {
			if (tokenOnDisk(sessionFile) !== entry.token) throw new SessionLockedError(sessionFile);
			take(sessionFile, timing, entry, onCompromised);
		} catch {
			entry.lost = true;
			if (held.get(key) === entry) held.delete(key);
		}
	};
	take(sessionFile, timing, entry, onCompromised);
	return entry;
}

/** Lock one canonical filesystem identity. Its directory must exist. */
export function acquireSessionLock(
	sessionFile: string,
	timing: LockTiming = defaultTiming,
	exclusive = false,
): SessionLock {
	sessionFile = canonicalSessionPath(sessionFile);
	if (fs.existsSync(sessionFile) && fs.statSync(sessionFile).nlink > 1) throw new SessionHardLinkedError(sessionFile);
	const key = keyOf(sessionFile);
	let entry = held.get(key);
	// No local check has seen a takeover yet: counting on that entry would hand out a lost lock.
	if (entry && tokenOnDisk(sessionFile) !== entry.token) {
		entry.lost = true;
		held.delete(key);
		entry = undefined;
	}
	// A file move cannot share ownership: remaining managers would write to the old name.
	// An exclusive reservation also refuses new counted handles until publication finishes.
	if (entry && (exclusive || entry.exclusive)) throw new SessionLockedError(sessionFile, "this process");
	if (!entry) {
		entry = createHeld(sessionFile, key, timing);
		entry.exclusive = exclusive;
		held.set(key, entry);
	}
	const owned = entry;
	owned.count++;
	const check = () => {
		if (!owned.lost && tokenOnDisk(sessionFile) !== owned.token) {
			owned.lost = true;
			if (held.get(key) === owned) held.delete(key);
		}
		return owned.lost;
	};
	let released = false;
	return {
		get lost() {
			return check();
		},
		covers: (file) => keyOf(file) === key,
		release() {
			if (released) return;
			released = true;
			if (--owned.count > 0) return;
			if (held.get(key) === owned) held.delete(key);
			// A lost lock stays in proper-lockfile's table until its refresh reports the compromise; the
			// guarded fs makes that refresh, and the exit handler, leave the other holder's directory alone.
			if (check()) return;
			try {
				owned.unlock();
				// Another process may have taken the lock and written its token since unlock().
				if (tokenOnDisk(sessionFile) === owned.token) fs.rmSync(ownerFile(sessionFile), { force: true });
			} catch {
				// Already gone (the directory was deleted); released is what the caller wanted.
			}
		},
	};
}
