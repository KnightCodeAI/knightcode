/**
 * Codex's "Save as…" for a file (26.1016 main bundle, its workspace files' saveCopy): the save dialog proposes the
 * file's own name, a choice of the file itself writes nothing, and the copy lands whole or not at all.
 */

import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

/** The name the dialog proposes: the last segment with Windows' reserved characters replaced (Codex's xe). */
export function proposedName(path: string): string {
	const last = (path.replaceAll("\\", "/").replace(/\/+$/u, "").split("/").at(-1) ?? "").replace(/[<>:"|?*\0]/gu, "_");
	return last === "." || last === ".." || last === "" ? "download" : last;
}

/**
 * The bytes written beside `destination` under a unique name, then renamed over it, keeping an existing file's mode
 * (Codex's aJ): a failed write leaves the destination as it was.
 */
export async function writeWhole(destination: string, bytes: Buffer): Promise<void> {
	const mode = await stat(destination).then(
		(s) => s.mode & 0o777,
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return undefined;
			throw error;
		},
	);
	const temporary = join(dirname(destination), `${basename(destination).slice(0, 64)}.${randomUUID()}.download`);
	const handle = await open(temporary, "wx", mode === undefined ? 0o666 : 0o600);
	try {
		await handle.writeFile(bytes);
		if (mode !== undefined) await handle.chmod(mode);
		await handle.close();
		await rename(temporary, destination);
	} finally {
		await handle.close().catch(() => {});
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
	if (resolve(destination) !== resolve(path)) await writeWhole(destination, await readFile(path));
	return destination;
}
