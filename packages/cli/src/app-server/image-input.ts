/** `{path}` images (§4.2): the client and server share a disk, so a screenshot need not cross the wire as base64. */

import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ImageInput, ImageRef } from "@knightcode/app-server-protocol";
import { AppServerError } from "./errors.ts";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

const SIGNATURES: { mimeType: string; test: (head: Buffer) => boolean }[] = [
	{
		mimeType: "image/png",
		test: (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
	},
	{ mimeType: "image/jpeg", test: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
	{ mimeType: "image/gif", test: (h) => h.subarray(0, 4).toString("ascii") === "GIF8" },
	{
		mimeType: "image/webp",
		test: (h) => h.subarray(0, 4).toString("ascii") === "RIFF" && h.subarray(8, 12).toString("ascii") === "WEBP",
	},
];

export interface PositionalReader {
	read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
}

/**
 * Read from the start until end of file or one byte past `limit`, whichever comes first. A single read may
 * return fewer bytes than asked for, so this loops; the extra byte lets the caller tell "exactly at the limit"
 * from "over it" without reading the rest of a huge file.
 */
export async function readAtMost(file: PositionalReader, limit: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let total = 0;
	while (total <= limit) {
		const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, limit + 1 - total));
		const { bytesRead } = await file.read(chunk, 0, chunk.length, total);
		if (bytesRead === 0) break;
		chunks.push(chunk.subarray(0, bytesRead));
		total += bytesRead;
	}
	return Buffer.concat(chunks, total);
}

export async function readImageInput(input: ImageInput): Promise<ImageRef> {
	if (!("path" in input)) return input;
	const refuse = (why: string) => new AppServerError("invalidParams", `image ${input.path}: ${why}`);
	if (!isAbsolute(input.path)) throw refuse("the path must be absolute");
	// Open once and stat the handle, so a file swapped after the check is not the one read. Symlinks are
	// followed by open, so the size checked is the target's.
	const handle = await open(input.path, "r").catch((error: unknown) => {
		throw refuse(`cannot be opened (${(error as NodeJS.ErrnoException).code ?? "error"})`);
	});
	try {
		const stats = await handle.stat();
		if (!stats.isFile()) throw refuse("not a regular file");
		if (stats.size > MAX_IMAGE_BYTES) throw refuse("larger than 20 MiB");
		const bytes = await readAtMost(handle, MAX_IMAGE_BYTES);
		if (bytes.length > MAX_IMAGE_BYTES) throw refuse("larger than 20 MiB");
		if (bytes.length !== stats.size) throw refuse("the file changed while it was read");
		const kind = SIGNATURES.find((s) => s.test(bytes));
		if (!kind) throw refuse("not a PNG, JPEG, GIF or WebP image");
		return { mimeType: kind.mimeType, data: bytes.toString("base64") };
	} catch (error) {
		if (error instanceof AppServerError) throw error;
		// stat or read failing after a successful open (the file was removed, a network drive dropped) is a
		// problem with the path the client gave, not a server fault.
		throw refuse(`cannot be read (${(error as NodeJS.ErrnoException).code ?? String(error)})`);
	} finally {
		await handle.close().catch(() => {});
	}
}
