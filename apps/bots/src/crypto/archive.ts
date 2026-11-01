// Sealed archives (spec sections 13 and 21): a stream, such as a computer's workspace snapshot, cut into 64 KiB
// segments sealed one by one. Each segment's AAD binds the storage id, the generation, its index and whether it is
// the last, so a segment moved, altered or taken from another archive or generation does not open. The manifest's
// tag is itself sealed: it holds a digest of the ordered segment tags, with the segment count and byte total in its
// AAD, so a missing, extra or reordered segment is refused and a truncated archive cannot pass with a rewritten
// manifest. Web Crypto only.
import { base64url } from "../auth/util.ts";
import { open, openBytes, seal, sealBytes } from "./envelope.ts";

const SEGMENT_BYTES = 64 * 1024;
const GCM_TAG_BYTES = 16;

export interface ArchiveManifest {
	storageId: string;
	generation: number;
	segments: number;
	bytes: number;
	tag: string;
}

const segmentAad = (ids: { storageId: string; generation: number }, index: number, last: boolean) =>
	`archive-segment:${ids.storageId}:${ids.generation}:${index}:${last ? "last" : "more"}`;
const manifestAad = (manifest: Omit<ArchiveManifest, "tag">) =>
	`archive-manifest:${manifest.storageId}:${manifest.generation}:${manifest.segments}:${manifest.bytes}`;

async function digest(tags: Uint8Array[]): Promise<Uint8Array> {
	const all = new Uint8Array(tags.length * GCM_TAG_BYTES);
	tags.forEach((tag, i) => all.set(tag, i * GCM_TAG_BYTES));
	return new Uint8Array(await crypto.subtle.digest("SHA-256", all));
}

/** `source` regrouped into 64 KiB pieces; the last may be shorter. */
async function* pieces(source: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
	let buffer = new Uint8Array(SEGMENT_BYTES);
	let filled = 0;
	for await (const chunk of source) {
		let offset = 0;
		while (offset < chunk.length) {
			const n = Math.min(SEGMENT_BYTES - filled, chunk.length - offset);
			buffer.set(chunk.subarray(offset, offset + n), filled);
			filled += n;
			offset += n;
			if (filled === SEGMENT_BYTES) {
				yield buffer;
				buffer = new Uint8Array(SEGMENT_BYTES);
				filled = 0;
			}
		}
	}
	if (filled > 0) yield buffer.subarray(0, filled);
}

/**
 * Seals `source` as it is read. `segments` yields each sealed segment; `manifest` settles once the last one has been
 * read (and rejects if sealing fails).
 */
export function sealArchive(
	key: CryptoKey,
	source: AsyncIterable<Uint8Array>,
	ids: { storageId: string; generation: number },
): { segments: AsyncIterable<Uint8Array>; manifest: Promise<ArchiveManifest> } {
	let settle!: (manifest: ArchiveManifest) => void;
	let fail!: (error: unknown) => void;
	const manifest = new Promise<ArchiveManifest>((resolve, reject) => {
		settle = resolve;
		fail = reject;
	});
	// Read before the consumer awaits it, so an unread rejection is not reported as unhandled.
	manifest.catch(() => undefined);
	async function* segments(): AsyncIterable<Uint8Array> {
		try {
			const tags: Uint8Array[] = [];
			let bytes = 0;
			let index = 0;
			// One piece is held back so the last can be marked as last.
			let pending: Uint8Array | undefined;
			const emit = async (piece: Uint8Array, last: boolean) => {
				const sealed = await sealBytes(key, piece, segmentAad(ids, index, last));
				tags.push(sealed.slice(sealed.length - GCM_TAG_BYTES));
				bytes += piece.length;
				index += 1;
				return sealed;
			};
			for await (const piece of pieces(source)) {
				if (pending) yield await emit(pending, false);
				pending = piece;
			}
			if (pending) yield await emit(pending, true);
			const fields = { storageId: ids.storageId, generation: ids.generation, segments: index, bytes };
			settle({ ...fields, tag: await seal(key, await digest(tags), manifestAad(fields)) });
		} catch (error) {
			fail(error);
			throw error;
		}
	}
	return { segments: segments(), manifest };
}

/** The plaintext of an archive sealed by `sealArchive`; throws on any missing, extra, reordered or altered segment. */
export async function* openArchive(
	key: CryptoKey,
	segments: AsyncIterable<Uint8Array>,
	manifest: ArchiveManifest,
): AsyncIterable<Uint8Array> {
	// The manifest opens only with its own count, byte total, storage id and generation.
	const expected = await open(key, manifest.tag, manifestAad(manifest));
	const tags: Uint8Array[] = [];
	let bytes = 0;
	let index = 0;
	for await (const sealed of segments) {
		if (index >= manifest.segments) throw new Error("archive has an extra segment");
		const plaintext = await openBytes(key, sealed, segmentAad(manifest, index, index === manifest.segments - 1));
		tags.push(sealed.slice(sealed.length - GCM_TAG_BYTES));
		bytes += plaintext.length;
		index += 1;
		yield plaintext;
	}
	if (index !== manifest.segments) throw new Error("archive is missing segments");
	if (bytes !== manifest.bytes) throw new Error("archive size does not match its manifest");
	if (base64url(await digest(tags)) !== base64url(expected)) throw new Error("archive segments do not match their manifest");
}
