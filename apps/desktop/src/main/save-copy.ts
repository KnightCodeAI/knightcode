/**
 * Codex's "Save as…" for a file (26.1016 main bundle, its workspace files' saveCopy): the save dialog proposes the
 * file's own name, a choice of the file itself writes nothing, and the copy lands whole or not at all.
 */

import { randomUUID } from "node:crypto";
import { chmod, constants, copyFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/** The name the dialog proposes: the last segment with Windows' reserved characters replaced (Codex's xe). */
export function proposedName(path: string): string {
	const last = (path.replaceAll("\\", "/").replace(/\/+$/u, "").split("/").at(-1) ?? "").replace(/[<>:"|?*\0]/gu, "_");
	return last === "." || last === ".." || last === "" ? "download" : last;
}

/**
 * `source` copied beside `destination` under a unique name, then renamed over it, keeping an existing file's mode
 * (Codex's aJ): a failed copy leaves the destination as it was. Copied, not read: a file of any size, none in memory.
 */
export async function writeWhole(destination: string, source: string): Promise<void> {
	const mode = await stat(destination).then(
		(s) => s.mode & 0o777,
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return undefined;
			throw error;
		},
	);
	const temporary = join(dirname(destination), `${basename(destination).slice(0, 64)}.${randomUUID()}.download`);
	try {
		await copyFile(source, temporary, constants.COPYFILE_EXCL);
		if (mode !== undefined) await chmod(temporary, mode);
		await rename(temporary, destination);
	} finally {
		await rm(temporary, { force: true });
	}
}

/** Copy `path` to where `choose` says; undefined when the user cancels. */
export async function saveCopy(
	path: string,
	choose: (proposed: string) => Promise<string | undefined>,
): Promise<string | undefined> {
	const destination = await choose(proposedName(path));
	if (!destination) return undefined;
	if (resolve(destination) !== resolve(path)) await writeWhole(destination, path);
	return destination;
}
