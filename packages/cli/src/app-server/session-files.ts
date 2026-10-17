/** Where session files live, and finding one by the id in its header (§5.8). */

import { existsSync } from "node:fs";
import { link, lstat, mkdir, readdir, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
	acquireSessionLock,
	canonicalSessionPath,
	type SessionLock,
	SessionLockedError,
	SessionHardLinkedError,
} from "../core/session-lock.ts";
import { AppServerError } from "./errors.ts";
import { findSessionFileInDir, getDefaultSessionDir, readSessionHeaderForDiscovery } from "../core/session-manager.ts";
import { resolvePath } from "../utils/paths.ts";
import type { AppServerContext } from "./context.ts";

export const ARCHIVE_DIR = "archived";

export function liveDirFor(ctx: AppServerContext, cwd: string): string {
	return ctx.sessionDir ?? getDefaultSessionDir(resolvePath(cwd), ctx.agentDir);
}

/** Every session directory: the explicit one, or each project's under the agent dir; their `archived/` when asked. */
export async function sessionDirs(ctx: AppServerContext, archived = false): Promise<string[]> {
	let dirs: string[];
	if (ctx.sessionDir !== undefined) {
		dirs = [ctx.sessionDir];
	} else {
		const root = join(ctx.agentDir, "sessions");
		const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
		dirs = entries.filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => join(root, e.name));
	}
	return (archived ? dirs.map((dir) => join(dir, ARCHIVE_DIR)) : dirs).filter((dir) => existsSync(dir));
}

export function isArchivedPath(file: string): boolean {
	return basename(dirname(file)) === ARCHIVE_DIR;
}

/** Parent identity comes from its header, also after an archive move, never from the file name. */
export function parentIdOf(path: string | undefined, onRead?: (path: string) => void): string | undefined {
	if (!path) return undefined;
	const dir = dirname(path);
	const name = basename(path);
	const candidates = isArchivedPath(path) ? [path, join(dirname(dir), name)] : [path, join(dir, ARCHIVE_DIR, name)];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		onRead?.(candidate);
		const id = readSessionHeaderForDiscovery(candidate)?.id;
		if (id) return id;
	}
	return undefined;
}

/**
 * Thread id to session file. Goes by the id in each file's header, not its name: an imported or
 * renamed transcript keeps its header id under another name. A remembered path is confirmed by
 * re-reading its header, so a moved or deleted file falls through to a scan.
 */
export class SessionFileIndex {
	private readonly ctx: AppServerContext;
	private readonly paths = new Map<string, string>();

	constructor(ctx: AppServerContext) {
		this.ctx = ctx;
	}

	remember(id: string, file: string): void {
		this.paths.set(id, file);
	}

	forget(id: string): void {
		this.paths.delete(id);
	}

	// ponytail: a miss reads every header in every session dir; keep a persistent index if that shows up.
	async find(id: string): Promise<string | undefined> {
		const known = this.paths.get(id);
		if (known && existsSync(known) && readSessionHeaderForDiscovery(known)?.id === id) return known;
		for (const archived of [false, true]) {
			for (const dir of await sessionDirs(this.ctx, archived)) {
				const file = findSessionFileInDir(dir, id);
				if (file) {
					this.paths.set(id, file);
					return file;
				}
			}
		}
		this.paths.delete(id);
		return undefined;
	}

	/** Every file whose header id is `id`, live and archived. More than one is a duplicate to report, never to pick from. */
	async findAll(id: string): Promise<string[]> {
		const found: string[] = [];
		for (const archived of [false, true]) {
			for (const dir of await sessionDirs(this.ctx, archived)) {
				for (const name of await readdir(dir).catch((): string[] => [])) {
					if (!name.endsWith(".jsonl")) continue;
					const path = join(dir, name);
					if (readSessionHeaderForDiscovery(path)?.id === id) found.push(path);
				}
			}
		}
		return found;
	}
}

/** Publish without replacement while retaining ownership through the index update. */
export async function moveSessionFileWithoutReplace(
	source: string,
	destination: string,
	expectedId: string,
	onPublished: () => void,
): Promise<void> {
	const conflict = (reason: string, message: string, paths = [source, destination]) =>
		new AppServerError("archiveConflict", message, {
			reason,
			paths,
			recoveryInstructions: [
				"Keep the transcript at its intended live or archived path. Resolve duplicate names or destination collisions, then retry.",
			],
		});
	const sourceInfo = await lstat(source);
	if (sourceInfo.isSymbolicLink()) throw conflict("symlinkSource", "Archive source must not be a symlink");
	await mkdir(dirname(destination), { recursive: true });
	source = canonicalSessionPath(source);
	destination = canonicalSessionPath(destination);
	const key = (path: string) => (process.platform === "win32" ? path.toLowerCase() : path);
	if (key(source) === key(destination))
		throw conflict("samePath", "Archive source and destination identify the same path");
	const locks: SessionLock[] = [];
	try {
		for (const path of [source, destination].sort((a, b) => key(a).localeCompare(key(b))))
			locks.push(acquireSessionLock(path, undefined, true));
		const original = await lstat(source);
		if (original.isSymbolicLink() || original.dev !== sourceInfo.dev || original.ino !== sourceInfo.ino)
			throw conflict("sourceChanged", "Archive source changed before publication");
		if (readSessionHeaderForDiscovery(source)?.id !== expectedId)
			throw conflict("sourceChanged", "Archive source no longer contains the expected thread");
		const existing = await lstat(destination).catch((error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			return undefined;
		});
		if (existing) throw conflict("destinationExists", "Archive destination already exists");
		if (locks.some((lock) => lock.lost))
			throw new AppServerError("threadLockedElsewhere", "Archive ownership was lost before publication");
		try {
			await link(source, destination);
		} catch (error) {
			throw conflict(
				"publicationFailed",
				`Cannot publish archive destination without replacement: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		try {
			if (locks.some((lock) => lock.lost)) throw new Error("Archive ownership was lost");
			await unlink(source);
		} catch (error) {
			try {
				const [from, to] = await Promise.all([lstat(source), lstat(destination)]);
				if (
					locks.some((lock) => lock.lost) ||
					from.dev !== original.dev ||
					from.ino !== original.ino ||
					to.dev !== original.dev ||
					to.ino !== original.ino ||
					to.isSymbolicLink()
				)
					throw new Error("Archive names changed; refusing to remove an unverified destination");
				await unlink(destination);
			} catch (rollback) {
				throw conflict(
					"rollbackFailed",
					`Archive source could not be removed and rollback failed: ${rollback instanceof Error ? rollback.message : String(rollback)}`,
				);
			}
			throw conflict(
				"sourceUnlinkFailed",
				`Archive publication was rolled back: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		try {
			onPublished();
		} catch (error) {
			throw conflict(
				"indexUpdateFailed",
				`Transcript is saved at the destination, but its index update failed: ${error instanceof Error ? error.message : String(error)}`,
				[destination],
			);
		}
	} catch (error) {
		if (error instanceof SessionLockedError) throw new AppServerError("threadLockedElsewhere", error.message);
		if (error instanceof SessionHardLinkedError) throw conflict("duplicateLinks", error.message);
		throw error;
	} finally {
		for (const lock of locks.reverse()) lock.release();
	}
}
