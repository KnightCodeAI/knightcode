/**
 * `file/read` (§4.4): a file's text for a desktop file tab. The server reads files, the desktop never does (shell
 * §17). Not confined to the workspace: a tool row may name any file the agent read.
 */

import { open, stat } from "node:fs/promises";
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
	};
}
