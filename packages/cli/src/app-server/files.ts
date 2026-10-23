/**
 * `file/read`, `file/list` and `file/write` (§4.4): a file's text for a desktop file tab, a folder for its tree, a
 * save. The server reads and writes files, the desktop never does (shell §17). Not confined to the workspace: a tool
 * row may name any file the agent read.
 */

import { open, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { ResultOf } from "@knightcode/app-server-protocol";
import { resolvePath } from "../utils/paths.ts";
import { AppServerError } from "./errors.ts";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
/** git's own binary test looks this far for a NUL. */
const BINARY_PROBE_BYTES = 8 * 1024;

export async function readFile(
	cwd: string,
	path: string,
	maxBytes = DEFAULT_MAX_BYTES,
): Promise<ResultOf<"file/read">> {
	const absolute = resolvePath(path, cwd);
	const info = await stat(absolute).catch(() => undefined);
	if (!info) throw new AppServerError("invalidParams", `no such file: ${path}`);
	// A directory, a FIFO (a read would block) or a device: not a file to show.
	if (!info.isFile()) throw new AppServerError("invalidParams", `not a file: ${path}`);
	// Up to maxBytes + 1, whatever the size was at stat (the file may grow): the byte past the limit says it is too large.
	const buffer = Buffer.allocUnsafe(maxBytes + 1);
	// Seen by stat but not readable (permissions, or removed since): a refusal for that path, as stat's are.
	const handle = await open(absolute, "r").catch((error: unknown) => {
		throw new AppServerError(
			"invalidParams",
			`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	let length = 0;
	try {
		for (;;) {
			const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
			if (bytesRead === 0) break;
			length += bytesRead;
			if (length === buffer.length) break;
		}
	} finally {
		await handle.close();
	}
	const binary = buffer.subarray(0, Math.min(length, BINARY_PROBE_BYTES)).includes(0);
	const tooLarge = length > maxBytes;
	return {
		path: absolute,
		size: tooLarge ? Math.max(info.size, length) : length,
		binary,
		tooLarge,
		// UTF-8 with U+FFFD for what does not decode.
		...(binary || tooLarge ? {} : { text: buffer.toString("utf8", 0, length) }),
		mtimeMs: info.mtimeMs,
	};
}

const MAX_ENTRIES = 5_000;

/**
 * `file/list`: one folder's entries for the desktop's tree, hidden ones included (Codex's tree shows `.git`). A link
 * to a folder is a folder, followed only when the tree opens it; a link that resolves to nothing is a file.
 */
export async function listFolder(cwd: string, path: string | undefined): Promise<ResultOf<"file/list">> {
	const folder = path === undefined ? cwd : resolvePath(path, cwd);
	const info = await stat(folder).catch(() => undefined);
	if (!info?.isDirectory()) throw new AppServerError("invalidParams", `not a folder: ${path ?? cwd}`);
	const dirents = await readdir(folder, { withFileTypes: true }).catch((error: unknown) => {
		throw new AppServerError(
			"invalidParams",
			`cannot list ${path ?? cwd}: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	const base = relative(cwd, folder).split(sep).join("/");
	const entries = await Promise.all(
		dirents.slice(0, MAX_ENTRIES).map(async (entry) => {
			const directory = entry.isSymbolicLink()
				? await stat(join(folder, entry.name)).then(
						(target) => target.isDirectory(),
						() => false,
					)
				: entry.isDirectory();
			return { path: base ? `${base}/${entry.name}` : entry.name, type: directory ? "directory" : "file" } as const;
		}),
	);
	return { root: cwd, entries, truncated: dirents.length > MAX_ENTRIES };
}

/**
 * `file/write`: a file tab's text written in place (the file keeps its identity, mode and links), refused when it
 * changed since the read whose mtime the tab holds (Codex's saveText).
 */
export async function writeText(
	cwd: string,
	path: string,
	text: string,
	expectedMtimeMs: number | undefined,
): Promise<ResultOf<"file/write">> {
	const absolute = resolvePath(path, cwd);
	const info = await stat(absolute).catch(() => undefined);
	if (info && !info.isFile()) throw new AppServerError("invalidParams", `not a file: ${path}`);
	if (expectedMtimeMs !== undefined && info?.mtimeMs !== expectedMtimeMs)
		throw new AppServerError("fileChanged", `${path} changed on disk since it was read`);
	await writeFile(absolute, text, "utf8").catch((error: unknown) => {
		throw new AppServerError(
			"invalidParams",
			`cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	return { mtimeMs: (await stat(absolute)).mtimeMs };
}
